/**
 * ConversationService (M2): per-session ConversationFold state keyed by
 * sessionId, fed from two sources that must converge on the same surface —
 * live mux frames (synthesized from session/follow stream items by
 * DshService) and `session/page` replay (the M2 generation/replay protocol
 * claim). `attach` seeds a fold from the follow snapshot (which carries the
 * opening window + cursor + projections) and drains frames that raced in
 * during the fetch, seq-deduped, so no update is lost or doubled. `resync`
 * re-attaches every tracked session after a mux reconnect, mirroring the
 * reference client's reconnect = reopen stream + refetch history.
 *
 * M4: host/agent-error (no turn position) folds into a per-session note at
 * the snapshot layer — the fold stays a pure session-event fold, host frames
 * never enter it; the note is appended to the folded items.
 *
 * M4b: the follow snapshot's `projections` block (when the deployment mounts
 * a projection registry) is forwarded through the optional `onProjections`
 * callback so the ProjectionService can seed its store from the same single
 * follow opening — no duplicate request, and the seed rides this service's
 * attach/resync lifecycle.
 *
 * History pagination: the follow snapshot only covers the newest messages
 * (server default window), so `attach` records `hasMore` and `loadOlder`
 * pages backwards via `session/page` using the snapshot's `cursor` as
 * `throughSeq` and `beforeSeq` as the window's earliest event seq. Events
 * already held in memory survive a re-attach/resync (merge by seq) — a
 * reconnect must never make the messages the user already loaded disappear.
 * The window is always one contiguous seq range, so the fold is rebuilt
 * deterministically from the merged event list on every page change.
 */

import { EventEmitter } from "node:events";
import {
  ConversationFold,
  type WireSessionEvent,
} from "../conversation/fold.ts";
import type { WireClient } from "../dsh/wire.ts";
import type {
  ConversationItem,
  ConversationSnapshot,
} from "../shared/protocol.ts";
import type { ProjectionsBlock } from "./projection-service.ts";

/** A synthesized mux frame (DshService emits these from session/follow items). */
interface MuxFrameEnvelope {
  payload: unknown;
}

/** One session/page record: a raw event or a packed Assistant delta run. */
type SessionHistoryRecord =
  | { type: "event"; event: WireSessionEvent }
  | { type: "chunks"; event: { type: string; seq: number; data: unknown } };

/** session/page response value (structural mirror). */
export interface HistoryPage {
  records: SessionHistoryRecord[];
  hasMore: boolean;
}

/** session/follow snapshot frame (structural mirror). */
export interface FollowSnapshot {
  type: "snapshot";
  header: { id: string; cwd?: string; agentPreset?: string };
  cursor: number;
  records: readonly SessionHistoryRecord[];
  hasMore: boolean;
  projections?: { asOfSeq: number; values: Record<string, unknown> };
}

/** The mux frame payloads this service consumes (others are M4/v2). */
type MuxFrame =
  | { type: "session/event"; sessionId: string; event: WireSessionEvent }
  | { type: "session/subscribed"; sessionId: string; lastSeq: number };

/** Per-session tracked state: the fold plus the raw event window it was built from. */
interface TrackedSession {
  fold: ConversationFold;
  /** All applied events in strictly ascending seq order (deduped by seq). */
  events: WireSessionEvent[];
  /** True when older events exist below the loaded window（loadOlder 可用）。 */
  hasMore: boolean;
  /** loadOlder in flight（防重复翻页）。 */
  loadingOlder: boolean;
  /** The follow snapshot cursor (inclusive log cut for session/page). */
  cursor: number;
}

/** Rebuild a fold from an ordered, seq-deduped event list (replay determinism). */
function buildFold(events: WireSessionEvent[]): ConversationFold {
  const fold = new ConversationFold();
  for (const event of events) fold.apply(event);
  return fold;
}

/** Merge event lists into one ascending, seq-deduped list (first wins per seq). */
function mergeEvents(lists: WireSessionEvent[][]): WireSessionEvent[] {
  const bySeq = new Map<number, WireSessionEvent>();
  for (const list of lists) {
    for (const event of list) if (!bySeq.has(event.seq)) bySeq.set(event.seq, event);
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** Extract WireSessionEvent values from SessionHistoryRecord entries. */
function recordsToEvents(records: readonly SessionHistoryRecord[]): WireSessionEvent[] {
  const events: WireSessionEvent[] = [];
  for (const record of records) {
    if (record.type === "event") events.push(record.event);
    // `chunks` records are packed Assistant delta runs; the fold treats them
    // as opaque events keyed by seq. They are not WireSessionEvent-shaped but
    // the fold's applyIfNewer only reads seq, so a minimal shape suffices.
    else
      events.push({
        type: record.event.type,
        seq: record.event.seq,
        time: 0,
        data: record.event.data as never,
      });
  }
  return events;
}

export class ConversationService extends EventEmitter {
  private readonly tracked = new Map<string, TrackedSession>();
  /** Frames buffered while a fetch is mid-flight (drained seq-deduped). */
  private readonly pending = new Map<string, WireSessionEvent[]>();
  /** M4: per-session host/agent-error notes (no turn position; appended at snapshot layer). */
  private readonly agentErrors = new Map<string, string[]>();
  /** M4b: optional projections-block sink (seeded from the follow snapshot). */
  private readonly onProjections?: (
    sessionId: string,
    block: ProjectionsBlock,
  ) => void;

  constructor(
    private readonly wire: () => WireClient | null,
    onProjections?: (sessionId: string, block: ProjectionsBlock) => void,
  ) {
    super();
    this.onProjections = onProjections;
  }

  /** The folded snapshot for a session, or null when not attached yet. */
  snapshot(sessionId: string): ConversationSnapshot | null {
    const tracked = this.tracked.get(sessionId);
    if (!tracked) return null;
    return this.withAgentErrorNotes(sessionId, {
      ...tracked.fold.snapshot(),
      hasMore: tracked.hasMore,
    });
  }

  /** M4: host/agent-error → per-session note (session-level failure visible in context). */
  applyAgentError(sessionId: string, message: string): void {
    const notes = this.agentErrors.get(sessionId) ?? [];
    notes.push(message);
    this.agentErrors.set(sessionId, notes);
    this.emit("change", sessionId);
  }

  /**
   * Rebuild the fold for a session from a session/follow snapshot. Safe
   * against concurrent live frames: they buffer in `pending` while the
   * snapshot is processed, then merge into the window by seq (frames already
   * covered by the snapshot are dropped, newer ones apply). Events already
   * held for the session survive the rebuild — a resync/re-select never drops
   * messages the user previously loaded, only re-baselines the tail.
   */
  applySnapshot(sessionId: string, snapshot: FollowSnapshot): ConversationSnapshot {
    const pending = this.pending.get(sessionId) ?? [];
    if (snapshot.projections !== undefined)
      this.onProjections?.(sessionId, snapshot.projections as ProjectionsBlock);
    const previous = this.tracked.get(sessionId);
    const events = mergeEvents([
      previous?.events ?? [],
      recordsToEvents(snapshot.records),
      pending.splice(0),
    ]);
    if (pending.length === 0) this.pending.delete(sessionId);
    const tracked: TrackedSession = {
      fold: buildFold(events),
      events,
      hasMore: resolveHasMore(snapshot.hasMore, previous, events),
      loadingOlder: previous?.loadingOlder ?? false,
      cursor: snapshot.cursor,
    };
    this.tracked.set(sessionId, tracked);
    this.emit("change", sessionId);
    return this.snapshot(sessionId) as ConversationSnapshot;
  }

  /**
   * Load the previous history page (backwards from the window's earliest
   * seq) via `session/page` and prepend it to the tracked window, rebuilding
   * the fold from the merged events. No-op when the window is complete,
   * already loading, or unattached. Frames racing in during the fetch buffer
   * in `pending` and merge on completion, exactly like `attach`.
   */
  async loadOlder(sessionId: string): Promise<ConversationSnapshot> {
    const initial = this.tracked.get(sessionId);
    if (!initial || !initial.hasMore || initial.loadingOlder) {
      return this.snapshot(sessionId) as ConversationSnapshot;
    }
    const beforeSeq = initial.events[0]?.seq;
    if (beforeSeq === undefined)
      return this.snapshot(sessionId) as ConversationSnapshot;
    initial.loadingOlder = true;
    const pending = this.pending.get(sessionId) ?? [];
    this.pending.set(sessionId, pending);
    try {
      const client = this.requireClient();
      const page = await client.call<HistoryPage>("session/page", {
        request: {
          address: { kind: "session", sessionId },
          throughSeq: initial.cursor,
          beforeSeq,
        },
      });
      // A concurrent attach (resync) may have replaced the tracked entry
      // mid-flight; land the page on the entry the map currently holds so
      // the loaded window is never lost.
      const target = this.tracked.get(sessionId) ?? initial;
      target.events = mergeEvents([
        recordsToEvents(page.records),
        target.events,
        pending.splice(0),
      ]);
      target.fold = buildFold(target.events);
      target.hasMore = page.hasMore;
      this.emit("change", sessionId);
      return this.snapshot(sessionId) as ConversationSnapshot;
    } finally {
      const target = this.tracked.get(sessionId) ?? initial;
      target.loadingOlder = false;
      if (pending.length === 0) this.pending.delete(sessionId);
    }
  }

  /**
   * Seed only the projection store for a session (no fold rebuild). Used when
   * the composer needs permission/todo data for an unbound or blank session
   * without selecting it — a light `session/page` tail read forwards the
   * projections block through the same sink `attach` uses. When no cursor is
   * known, a follow snapshot is the source; this method is a no-op when the
   * session is unattached (no cursor available).
   */
  async seedProjections(sessionId: string): Promise<void> {
    // Projections are seeded from the follow snapshot in applySnapshot; there
    // is no standalone cold read without a cursor in the new protocol. This
    // method is retained for compatibility and is a no-op when unattached.
    void sessionId;
  }

  /** Route one mux frame into the owning session's fold (or its pending buffer). */
  applyFrame(frame: MuxFrameEnvelope): void {
    const payload = frame.payload as MuxFrame;
    if (payload.type !== "session/event" || !payload.event) return; // subscribed/approval/etc: not M2
    const pending = this.pending.get(payload.sessionId);
    if (pending) {
      pending.push(payload.event);
      return;
    }
    const tracked = this.tracked.get(payload.sessionId);
    if (!tracked) return; // unattached session: history replay will cover it
    if (tracked.fold.applyIfNewer(payload.event)) {
      tracked.events.push(payload.event);
      this.emit("change", payload.sessionId);
    }
  }

  /** Re-attach every tracked session (mux reconnect; see module doc). */
  async resync(): Promise<void> {
    // In the new protocol, resync is driven by reopening session/follow
    // streams (owned by DshService/ChatView). The fold state survives; live
    // frames will re-apply via applyFrame. This method is retained for
    // compatibility and is a no-op here.
  }

  /** Drop a session's tracked state (session deletion / detach). */
  detach(sessionId: string): void {
    this.tracked.delete(sessionId);
    this.pending.delete(sessionId);
    this.agentErrors.delete(sessionId);
  }

  private requireClient(): WireClient {
    const client = this.wire();
    if (!client) throw new Error("dsh web 尚未就绪");
    return client;
  }

  /** Append cached agent-error notes to a folded snapshot (fold stays pure). */
  private withAgentErrorNotes(
    sessionId: string,
    snapshot: ConversationSnapshot,
  ): ConversationSnapshot {
    const notes = this.agentErrors.get(sessionId);
    if (!notes || notes.length === 0) return snapshot;
    const items: ConversationItem[] = [...snapshot.items];
    for (const message of notes)
      items.push({ kind: "note", text: `会话出错：${message}` });
    return { ...snapshot, items };
  }
}

/**
 * Derive `hasMore` for the merged window after an attach. The window is a
 * contiguous seq range; when the snapshot is the oldest thing we hold its
 * flag is authoritative, and when we preserved older pages the older-than-
 * window question is unchanged from what it was before the attach.
 */
function resolveHasMore(
  snapshotHasMore: boolean,
  previous: TrackedSession | undefined,
  merged: WireSessionEvent[],
): boolean {
  const mergedEarliest = merged[0]?.seq;
  if (mergedEarliest === undefined) {
    return snapshotHasMore;
  }
  if (previous === undefined) {
    return snapshotHasMore;
  }
  const previousEarliest = previous.events[0]?.seq;
  if (previousEarliest === undefined) {
    return snapshotHasMore;
  }
  // If we merged older events than the snapshot, the older-than-window
  // question is unchanged from what it was before the attach.
  if (mergedEarliest < previousEarliest) {
    return previous.hasMore;
  }
  return snapshotHasMore;
}
