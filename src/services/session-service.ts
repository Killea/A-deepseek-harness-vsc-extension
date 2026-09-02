/**
 * SessionService: workspace/session orchestration over the wire client
 * (D5, §6). Window ↔ Workspace is 1:1 on the folder root: ensureWorkspace
 * resolves the root via the cached Workspace baseline (from workspace/follow)
 * or creates it. Session lists render the current Workspace's accounted
 * sessions.
 *
 * dsh 0.1.2+: RPC methods are namespaced (`session/list`, `workspace/create`,
 * `workspace/archiveSession`) with `{ args: {...} }` payloads. The Workspace
 * baseline is no longer a one-shot RPC; it arrives via the `workspace/follow`
 * stream owned by DshService, which caches the latest baseline here.
 */

import { randomUUID } from "node:crypto";
import { DshRpcError, type WireClient } from "../dsh/wire.ts";
import type {
  SessionSummary,
  WorkspaceBaseline,
  WorkspaceView,
} from "../shared/protocol.ts";
import { canonicalPath } from "./path-util.ts";

export type { SessionSummary, WorkspaceView };

/** session.prompt 响应（command 槽仅在 prompt 分派了 / 命令时出现——v1 不拦截，当普通消息发送）。 */
export interface PromptResult {
  accepted: true;
  command?: { kind: "success"; text?: string };
}

export class SessionService {
  private workspace: WorkspaceView | null = null;
  /** Registry-global archive set (Host order), cached from workspace/follow. */
  private archivedSessionIds: string[] = [];
  /** The latest Workspace baseline from the workspace/follow stream. */
  private baseline: WorkspaceBaseline | null = null;

  /**
   * @param wire - lazy accessor for the live wire client; resolved on each
   *   call so the service works before and after dsh restart.
   */
  constructor(private readonly wire: () => WireClient | null) {}

  get currentWorkspace(): WorkspaceView | null {
    return this.workspace;
  }

  /** The registry-global archive set (sessions hidden from every grouping surface). */
  get archived(): readonly string[] {
    return this.archivedSessionIds;
  }

  /** Update the cached Workspace baseline from a workspace/follow frame. */
  applyWorkspaceFrame(frame: { payload: unknown }): void {
    const payload = frame.payload as
      | { type: "baseline"; value: WorkspaceBaseline }
      | { type: "upsert"; workspace: WorkspaceView }
      | { type: "remove"; workspaceId: string }
      | { type: "order"; workspaceIds: readonly string[] }
      | { type: "archived"; archivedSessionIds: readonly string[] };
    if (payload.type === "baseline") {
      this.baseline = payload.value;
      this.archivedSessionIds = [...payload.value.archivedSessionIds];
      this.refreshWorkspaceFromBaseline();
      return;
    }
    if (this.baseline === null) return; // no baseline yet; ignore increments
    if (payload.type === "upsert") {
      const idx = this.baseline.items.findIndex(
        (w) => w.workspaceId === payload.workspace.workspaceId,
      );
      if (idx >= 0)
        this.baseline = {
          ...this.baseline,
          items: [
            ...this.baseline.items.slice(0, idx),
            payload.workspace,
            ...this.baseline.items.slice(idx + 1),
          ],
        };
      else
        this.baseline = {
          ...this.baseline,
          items: [...this.baseline.items, payload.workspace],
        };
      this.refreshWorkspaceFromBaseline();
      return;
    }
    if (payload.type === "remove") {
      this.baseline = {
        ...this.baseline,
        items: this.baseline.items.filter(
          (w) => w.workspaceId !== payload.workspaceId,
        ),
      };
      this.refreshWorkspaceFromBaseline();
      return;
    }
    if (payload.type === "archived") {
      this.archivedSessionIds = [...payload.archivedSessionIds];
      this.baseline = {
        ...this.baseline,
        archivedSessionIds: [...payload.archivedSessionIds],
      };
      return;
    }
    // order: no cached shape change needed for session-list filtering.
  }

  /** Re-resolve the cached workspace from the current baseline. */
  private refreshWorkspaceFromBaseline(): void {
    if (this.workspace && this.baseline) {
      const fresh = this.baseline.items.find(
        (w) => w.workspaceId === this.workspace!.workspaceId,
      );
      this.workspace = fresh ?? null;
    }
  }

  private requireClient(): WireClient {
    const client = this.wire();
    if (!client) throw new Error("dsh web 尚未就绪");
    return client;
  }

  /** Resolve (or create) the Workspace for a folder root; caches the result. */
  async ensureWorkspace(folderRoot: string): Promise<WorkspaceView> {
    if (this.workspace) return this.workspace;
    const client = this.requireClient();
    // If we already have a baseline from workspace/follow, search it.
    const canonical = canonicalPath(folderRoot);
    if (this.baseline) {
      const existing = this.baseline.items.find(
        (item) => canonicalPath(item.path) === canonical,
      );
      if (existing) {
        this.workspace = existing;
        return existing;
      }
    }
    // No baseline or not found: create the Workspace.
    const created = await client.call<{
      workspace: WorkspaceView;
      created: boolean;
    }>("workspace/create", { request: { path: folderRoot } });
    this.workspace = created.workspace;
    return created.workspace;
  }

  /** Invalidate the cached workspace (folder root changed / window switch). */
  reset(): void {
    this.workspace = null;
    this.archivedSessionIds = [];
    this.baseline = null;
  }

  /**
   * Sessions accounted by the current Workspace, updatedAt descending.
   * Mirrors the reference client's visibility rule: archived and subagent
   * sessions are hidden everywhere; among blank sessions only the selected
   * one stays visible (the provisional "New Session" row).
   */
  async listSessions(
    selectedSessionId?: string | null,
  ): Promise<SessionSummary[]> {
    const workspace = this.workspace;
    if (!workspace) return [];
    const client = this.requireClient();
    // Refresh the workspace view from the cached baseline (session.create
    // attaches after publication, so the cached sessionIds may be stale until
    // the next workspace/follow increment).
    this.refreshWorkspaceFromBaseline();
    const fresh = this.workspace ?? workspace;
    this.workspace = fresh;
    const accounted = new Set(fresh.sessionIds);
    const archived = new Set(this.archivedSessionIds);
    const { items } = await client.call<{ items: SessionSummary[] }>(
      "session/list",
      { _request: {} },
    );
    return items
      .filter((item) => accounted.has(item.sessionId))
      .filter((item) => item.origin !== "subagent")
      .filter((item) => !archived.has(item.sessionId))
      .filter((item) => !item.blank || item.sessionId === selectedSessionId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Resolve the session a "New Session" flow opens: reuse the workspace's
   * existing blank session when one is in the list mirror, else create a fresh
   * one. Reuse requires workspace membership (id in sessionIds AND the same
   * cwd — the host's own membership rule) and excludes archived blanks,
   * mirroring the reference client's connectWorkspace.
   */
  async resolveNewSession(
    occupiedBlankSessionIds: readonly string[] = [],
  ): Promise<{ sessionId: string }> {
    const workspace = this.workspace;
    if (!workspace) throw new Error("尚未关联 Workspace，无法创建会话");
    const client = this.requireClient();
    this.refreshWorkspaceFromBaseline();
    const fresh = this.workspace ?? workspace;
    this.workspace = fresh;
    const { items } = await client.call<{ items: SessionSummary[] }>(
      "session/list",
      { _request: {} },
    );
    const archived = new Set(this.archivedSessionIds);
    const occupied = new Set(occupiedBlankSessionIds);
    for (const item of items) {
      if (
        item.blank &&
        item.cwd === fresh.path &&
        fresh.sessionIds.includes(item.sessionId) &&
        !archived.has(item.sessionId) &&
        !occupied.has(item.sessionId)
      ) {
        return { sessionId: item.sessionId };
      }
    }
    return await client.call<{ sessionId: string }>("session/create", {
      request: { workspaceId: fresh.workspaceId },
    });
  }

  /** Archive a session into the registry-global set; returns the full updated set. */
  async archiveSession(sessionId: string): Promise<readonly string[]> {
    const client = this.requireClient();
    const { archivedSessionIds } = await client.call<{
      archivedSessionIds: string[];
    }>("workspace/archiveSession", { request: { sessionId } });
    this.archivedSessionIds = archivedSessionIds;
    return archivedSessionIds;
  }

  /** Rename a session (host normalizes the raw title); returns the accepted title. */
  async renameSession(sessionId: string, title: string): Promise<string> {
    const client = this.requireClient();
    const result = await client.call<{ title: string; seq: number }>(
      "session/rename",
      { request: { sessionId, title } },
    );
    return result.title;
  }

  /**
   * Fork a session: the published child inherits the source's seeded history,
   * cwd, latest logged ModelSelection, and lineage before joining the source
   * Workspace. An optional `atSeq` anchor maps to the first turn/end at or
   * after it; omitted selects the last completed turn. Returns the child id.
   */
  async forkSession(
    sessionId: string,
    atSeq?: number,
  ): Promise<string> {
    const client = this.requireClient();
    const result = await client.call<{ sessionId: string }>(
      "session/fork",
      { request: { sessionId, ...(atSeq === undefined ? {} : { atSeq }) } },
    );
    return result.sessionId;
  }

  /** Replace the cached archive set from a host frame (archived-sessions-changed). */
  setArchived(ids: readonly string[]): void {
    this.archivedSessionIds = [...ids];
  }

  /** Send a prompt to a session.
   *  @param mode - 'queue' appends after the current turn; 'steer' interrupts it
   *  (busy-Enter 偏好解析后透传；dsh 对非运行态 steer 尽力退化为下一条唤醒 Queue 轮)。
   *  @param images - optional base64-encoded image attachments; emitted as
   *  `{ type: "image", mediaType, data, name }` content blocks before the text block. */
  async prompt(
    sessionId: string,
    text: string,
    mode: "queue" | "steer" = "queue",
    signal?: AbortSignal,
    images?: readonly { mediaType: string; data: string; name?: string }[],
  ): Promise<PromptResult> {
    const client = this.requireClient();
    const content: Array<{ type: string; text?: string; mediaType?: string; data?: string; name?: string }> = [];
    if (images) {
      for (const img of images) {
        content.push({ type: "image", mediaType: img.mediaType, data: img.data, name: img.name });
      }
    }
    content.push({ type: "text", text });
    return await client.call<PromptResult>(
      "session/prompt",
      {
        request: {
          requestId: randomUUID(),
          sessionId,
          mode,
          content,
        },
      },
      signal,
    );
  }

  /**
   * The session's cwd baseline from the live session list (M3 @ path baseline
   * verification; null when the session is unknown / has no recorded cwd).
   */
  async sessionCwd(sessionId: string | null): Promise<string | null> {
    if (!sessionId) return null;
    const client = this.requireClient();
    const { items } = await client.call<{ items: SessionSummary[] }>(
      "session/list",
      { _request: {} },
    );
    return items.find((item) => item.sessionId === sessionId)?.cwd ?? null;
  }

  /** Cancel a session's active turn (§9). */
  async cancel(sessionId: string): Promise<void> {
    const client = this.requireClient();
    try {
      await client.call<{ accepted: true }>("session/cancel", { request: { sessionId } });
    } catch (error) {
      // Cancel is idempotent from the UI's perspective. If no live agent is
      // attached, the requested postcondition (not running) already holds.
      if (error instanceof DshRpcError && error.code === "session-not-found")
        return;
      throw error;
    }
  }
}
