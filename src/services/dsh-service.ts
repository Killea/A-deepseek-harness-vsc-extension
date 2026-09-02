/**
 * One window-local DSH connection interface. Managed children live in the
 * cross-window Runtime Broker; external/discovered instances are never killed.
 *
 * dsh 0.1.2+ transport: one multiplexed `/api/remote.mux` WebSocket carries
 * the `$events` generation source plus per-session `session/follow` streams,
 * the `session/control` projection/queue/job stream, and the
 * `workspace/follow` stream. This service adapts the new frame shapes to the
 * extension's existing event surface so downstream services stay stable:
 *   - `mux` frames carry `{ type: "session/event", sessionId, event }` items
 *     synthesized from `session/follow` stream items.
 *   - `host` frames carry `{ type: "host/<event>", ... }` items synthesized
 *     from `$events` emit/waterfall frames.
 *   - `control` frames carry `SessionControlFrame` items from the
 *     `session/control` stream.
 *   - `workspace` frames carry `WorkspaceFollowFrame` items from the
 *     `workspace/follow` stream.
 */

import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { discoverDsh, type DshLauncher } from "../dsh/discovery.ts";
import {
  isTcpPortOccupied,
  loopbackDshUrl,
  normalizeDshBaseUrl,
  probeDsh,
} from "../dsh/probe.ts";
import {
  acquireRuntimeBroker,
  runtimeBrokerPaths,
  tryAcquireRuntimeBroker,
  type RuntimeBrokerLease,
} from "../dsh/runtime-broker-client.ts";
import { createWireValidator } from "../dsh/schemas.ts";
import {
  RemoteStreamMux,
  WireClient,
  REMOTE_EVENT_STREAM_ENDPOINT,
  REMOTE_EVENT_STREAM_PAYLOAD,
  type EnvelopeValidator,
  type RemoteStreamFailure,
} from "../dsh/wire.ts";

export type DshStatus =
  | "discovering" | "starting" | "ready" | "reconnecting" | "stopped" | "error";
export type DshOwnership =
  | "external-specified"
  | "external-discovered"
  | "external-managed-port"
  | "managed";

export interface DshServiceOptions {
  explicitPath?: string | null;
  externalUrl?: string | null;
  discoveryPort: number;
  managedPort: number;
  globalStoragePath: string;
  brokerScript: string;
  onStatus?: (status: DshStatus, detail?: string) => void;
  onLog?: (line: string) => void;
}

interface ResolvedTarget {
  baseUrl: string;
  ownership: DshOwnership;
  reportedVersion: string;
  home: string;
  /** Browser-session cookie for gateway auth (dsh 0.1.2+). */
  cookie?: string;
}

/** A synthesized mux frame: { type: "session/event", sessionId, event }. */
export interface SynthMuxFrame {
  payload: { type: "session/event"; sessionId: string; event: unknown };
}

/** A synthesized host frame: { type: "host/<event>", ... }. */
export interface SynthHostFrame {
  method: string;
  payload: { type: string; event?: string; args?: unknown[] } & Record<
    string,
    unknown
  >;
}

/** A control frame from the session/control stream. */
export interface ControlFrame {
  payload: unknown;
}

/** A workspace frame from the workspace/follow stream. */
export interface WorkspaceFrame {
  payload: unknown;
}

/** A `$events` waterfall frame (approval/request, user-questions/request). */
export interface WaterfallFrame {
  type: "waterfall";
  event: string;
  eventId: string;
  agentId: string;
  request: Record<string, unknown>;
}

export class DshService extends EventEmitter {
  private readonly options: DshServiceOptions;
  private launcher: DshLauncher | null = null;
  private brokerLease: RuntimeBrokerLease | null = null;
  private wire: WireClient | null = null;
  private validator: EnvelopeValidator | null = null;
  private mux: RemoteStreamMux | null = null;
  private currentBaseUrl: string | null = null;
  private ownership: DshOwnership | null = null;
  private reportedVersion: string | null = null;
  private home: string | null = null;
  /** Browser-session cookie for gateway authentication (dsh 0.1.2+). */
  private cookie: string | null = null;
  private started = false;
  private stopping = false;
  private status: DshStatus = "stopped";
  private generation = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private explicitPath: string | null | undefined;
  /** Active logical stream disposers, keyed by an opaque handle. */
  private readonly streamCancellers = new Map<string, () => void>();
  /** Per-session follow stream state. */
  private readonly followState = new Map<
    string,
    { cancel: () => void; snapshotSeen: boolean }
  >();
  /** The `$events` stream clientId for the current generation. */
  private eventsClientId: string | null = null;
  /** Pending waterfall deliveries awaiting a Client answer. */
  private readonly waterfalls = new Map<string, WaterfallFrame>();

  constructor(options: DshServiceOptions) {
    super();
    this.options = options;
    this.explicitPath = options.explicitPath;
  }

  get statusValue(): DshStatus {
    return this.status;
  }
  get baseUrl(): string | null {
    return this.currentBaseUrl;
  }
  get client(): WireClient | null {
    return this.wire;
  }
  get launcherValue(): DshLauncher | null {
    return this.launcher;
  }
  get ownershipValue(): DshOwnership | null {
    return this.ownership;
  }
  get reportedVersionValue(): string | null {
    return this.reportedVersion;
  }
  get homeValue(): string | null {
    return this.home;
  }

  async restart(explicitPath?: string | null): Promise<void> {
    await this.stop();
    if (explicitPath !== undefined) this.explicitPath = explicitPath;
    await this.start();
  }

  private setStatus(status: DshStatus, detail?: string): void {
    this.status = status;
    this.options.onStatus?.(status, detail);
    this.emit("status", status, detail);
  }

  /** Resolve one target, open the mux, and start the $events generation. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    this.launcher = null;
    try {
      this.setStatus("discovering");
      const target = await this.resolveTarget();
      this.currentBaseUrl = target.baseUrl;
      this.ownership = target.ownership;
      this.reportedVersion = target.reportedVersion;
      this.home = target.home;
      this.cookie = target.cookie ?? null;
      this.options.onLog?.(
        `dsh endpoint: ${target.baseUrl}; ownership=${target.ownership}; reportedVersion=${target.reportedVersion}; home=${target.home}`,
      );

      this.setStatus("starting");
      this.validator =
        target.ownership === "managed" && this.launcher
          ? await createWireValidator(this.launcher)
          : null;
      await this.openGeneration();
      this.setStatus("ready");
    } catch (error) {
      this.started = false;
      await this.releaseTarget();
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus("error", message);
      throw error;
    }
  }

  /** Disconnect this window; only the Broker may stop a managed child. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.started = false;
    this.generation += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.closeTransport();
    await this.releaseTarget();
    this.currentBaseUrl = null;
    this.ownership = null;
    this.reportedVersion = null;
    this.home = null;
    this.cookie = null;
    this.validator = null;
    this.setStatus("stopped");
  }

  private async resolveTarget(): Promise<ResolvedTarget> {
    const external = this.options.externalUrl?.trim();
    if (external) {
      const baseUrl = normalizeDshBaseUrl(external);
      const result = await probeDsh(baseUrl, 10_000);
      if (result.kind !== "dsh")
        throw new Error(`指定地址不是可用的 DSH：${result.reason}`);
      return {
        baseUrl: result.baseUrl,
        ownership: "external-specified",
        reportedVersion: this.launcher?.version ?? "unknown",
        home: result.description.home,
      };
    }

    const discoveryUrl = loopbackDshUrl(this.options.discoveryPort);
    const discovered = await probeDsh(discoveryUrl);
    if (discovered.kind === "dsh") {
      return {
        baseUrl: discovered.baseUrl,
        ownership: "external-discovered",
        reportedVersion: this.launcher?.version ?? "unknown",
        home: discovered.description.home,
      };
    }
    this.options.onLog?.(
      `默认端口未发现 DSH (${discoveryUrl}): ${discovered.reason}`,
    );

    const managedUrl = loopbackDshUrl(this.options.managedPort);
    const managed = await probeDsh(managedUrl);
    const paths = runtimeBrokerPaths(this.options.globalStoragePath);
    if (managed.kind === "dsh") {
      // If this endpoint belongs to our Broker, holding a lease prevents one
      // window from stopping the global child while another still uses it.
      this.brokerLease = await tryAcquireRuntimeBroker({
        paths,
        port: this.options.managedPort,
      });
      if (this.brokerLease) {
        return {
          baseUrl: this.brokerLease.baseUrl,
          ownership: this.brokerLease.managed
            ? "managed"
            : "external-managed-port",
          reportedVersion: this.brokerLease.reportedVersion,
          home: managed.description.home,
          ...(this.brokerLease.cookie === undefined
            ? {}
            : { cookie: this.brokerLease.cookie }),
        };
      }
      return {
        baseUrl: managed.baseUrl,
        ownership: "external-managed-port",
        reportedVersion: this.launcher?.version ?? "unknown",
        home: managed.description.home,
      };
    }
    // A Broker may already own the port while DSH is still booting. Acquire
    // its lease before classifying the transient listener as a conflict.
    this.brokerLease = await tryAcquireRuntimeBroker({
      paths,
      port: this.options.managedPort,
    });
    if (this.brokerLease) {
      return {
        baseUrl: this.brokerLease.baseUrl,
        ownership: this.brokerLease.managed
          ? "managed"
          : "external-managed-port",
        reportedVersion: this.brokerLease.reportedVersion,
        home: "",
        ...(this.brokerLease.cookie === undefined
          ? {}
          : { cookie: this.brokerLease.cookie }),
      };
    }
    if (await isTcpPortOccupied("127.0.0.1", this.options.managedPort)) {
      throw new Error(
        `DSH 管理端口 ${String(this.options.managedPort)} 已被其他程序占用：${managed.reason}`,
      );
    }

    this.setStatus("discovering", "正在查找 dsh 可执行文件");
    this.launcher = await discoverDsh({ explicitPath: this.explicitPath });
    this.options.onLog?.(
      `dsh package: ${this.launcher.version ?? "unknown"} @ ${this.launcher.command} (${this.launcher.source})`,
    );
    this.brokerLease = await acquireRuntimeBroker({
      paths,
      brokerScript: this.options.brokerScript,
      port: this.options.managedPort,
      launcher: this.launcher,
      globalStoragePath: this.options.globalStoragePath,
    });
    return {
      baseUrl: this.brokerLease.baseUrl,
      ownership: this.brokerLease.managed ? "managed" : "external-managed-port",
      reportedVersion: this.brokerLease.reportedVersion,
      home: "",
      ...(this.brokerLease.cookie === undefined
        ? {}
        : { cookie: this.brokerLease.cookie }),
    };
  }

  private async openGeneration(): Promise<void> {
    const baseUrl = this.currentBaseUrl;
    if (!baseUrl) throw new Error("DSH 连接目标尚未解析");
    const generation = ++this.generation;
    const wire = new WireClient(baseUrl, this.validator ?? undefined, this.cookie ?? undefined);
    const wsBase = baseUrl.replace(/^http:/u, "ws:").replace(/^https:/u, "wss:");
    const mux = new RemoteStreamMux(
      {
        url: `${wsBase}/api/remote.mux`,
        validator: this.validator ?? undefined,
        ...(this.cookie === null || this.cookie === undefined
          ? {}
          : { cookie: this.cookie }),
      },
      WebSocket,
    );
    this.wire = wire;
    this.mux = mux;

    let ready = false;
    let closedWhileOpening = false;
    const onClose = (): void => {
      if (!ready) {
        closedWhileOpening = true;
        return;
      }
      this.onGenerationClosed(generation);
    };
    mux.on("close", onClose);
    mux.on("error", (error: Error) =>
      this.options.onLog?.(`[remote.mux] ${error.message}`),
    );

    mux.start();
    try {
      // Open the $events generation source and await its ready item.
      const home = await this.openEventsStream(mux, generation);
      if (closedWhileOpening)
        throw new Error("DSH WebSocket 在连接代际就绪前关闭");
      this.home = home;
      ready = true;
    } catch (error) {
      if (generation === this.generation) {
        this.generation += 1;
        this.closeTransport();
      }
      throw error;
    }
  }

  /**
   * Open the `$events` logical stream and await its `ready` item. Once ready,
   * emit/waterfall frames are forwarded as synthesized `host` frames. Returns
   * the Host home from the ready item.
   */
  private openEventsStream(
    mux: RemoteStreamMux,
    generation: number,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const handle = mux.openStream(
        REMOTE_EVENT_STREAM_ENDPOINT,
        REMOTE_EVENT_STREAM_PAYLOAD,
        {
          onItem: (value) => {
            const item = value as
              | { type: "ready"; clientId: string; host: { home: string } }
              | { type: "emit"; event: string; args: readonly unknown[] }
              | WaterfallFrame
              | { type: "cancel"; eventId: string };
            if (!settled) {
              if (item.type === "ready") {
                settled = true;
                this.eventsClientId = item.clientId;
                resolve(item.host.home);
              } else {
                reject(new Error("$events 首帧不是 ready"));
              }
              return;
            }
            if (generation !== this.generation) return;
            this.dispatchEventsItem(item);
          },
          onEnd: () => {
            if (!settled) reject(new Error("$events 流在 ready 前结束"));
            // A ready-then-end invalidates the generation (reconnect).
            else if (generation === this.generation)
              this.onGenerationClosed(generation);
          },
          onError: (failure: RemoteStreamFailure) => {
            if (!settled)
              reject(new Error(`$events 流错误: ${failure.message}`));
            else if (generation === this.generation)
              this.onGenerationClosed(generation);
          },
        },
      );
      this.streamCancellers.set(`events:${generation}`, handle.cancel);
    });
  }

  /** Dispatch one `$events` item (after ready) as a synthesized host frame. */
  private dispatchEventsItem(item: {
    type: string;
    event?: string;
    args?: readonly unknown[];
    eventId?: string;
    agentId?: string;
    request?: Record<string, unknown>;
  }): void {
    if (item.type === "emit" && typeof item.event === "string") {
      this.emitHostFrame(item.event, item.args ?? []);
      return;
    }
    if (item.type === "waterfall" && typeof item.eventId === "string") {
      const frame: WaterfallFrame = {
        type: "waterfall",
        event: item.event ?? "",
        eventId: item.eventId,
        agentId: item.agentId ?? "",
        request: item.request ?? {},
      };
      this.waterfalls.set(frame.eventId, frame);
      // Emit a dedicated waterfall event so PendingInteractionService can
      // route approval/request and user-questions/request into its map.
      this.emit("waterfall", frame);
      return;
    }
    if (item.type === "cancel" && typeof item.eventId === "string") {
      this.waterfalls.delete(item.eventId);
      // Emit a resolution event so pending entries are removed.
      this.emit("waterfallCancel", item.eventId);
      return;
    }
  }

  /**
   * Emit one synthesized `host` frame from a `$events` emit. Maps the new
   * event names to the extension's existing `host/<event>` surface so
   * downstream wiring stays stable.
   */
  private emitHostFrame(event: string, args: readonly unknown[]): void {
    // Map new event names to the extension's existing host/* frame surface.
    const mapped = mapEventToHostMethod(event);
    const payload: SynthHostFrame["payload"] = {
      type: mapped,
      event,
      args: [...args],
    };
    // Carry the first arg as sessionId when it is a string (common shape).
    if (typeof args[0] === "string") payload.sessionId = args[0];
    this.emit("host", { method: mapped, payload });
  }

  /**
   * Answer one pending waterfall delivery (approval/request or
   * user-questions/request) through the `$events/result` Remote RPC.
   */
  async answerWaterfall(
    eventId: string,
    outcome:
      | { kind: "next" }
      | { kind: "result"; value?: unknown }
      | {
          kind: "rejected";
          error: {
            name: string;
            message: string;
            code?: string;
            details?: unknown;
          };
        },
  ): Promise<void> {
    const client = this.wire;
    if (!client || !this.eventsClientId) {
      throw new Error("dsh web 尚未就绪");
    }
    await client.answerRemoteEvent(this.eventsClientId, eventId, outcome);
    this.waterfalls.delete(eventId);
  }

  /** The currently pending waterfall for an eventId, or undefined. */
  pendingWaterfall(eventId: string): WaterfallFrame | undefined {
    return this.waterfalls.get(eventId);
  }

  /**
   * Open a `session/follow` logical stream for one session. Each item is
   * either a `snapshot` (opening window) or an `event` (live append). Items
   * are forwarded as synthesized `mux` frames so downstream services stay
   * stable. Returns a disposer that cancels the stream.
   */
  openSessionFollow(
    sessionId: string,
    onSnapshot: (snapshot: unknown) => void,
  ): () => void {
    const mux = this.mux;
    if (!mux) throw new Error("dsh web 尚未就绪");
    // Cancel any existing follow for this session.
    this.followState.get(sessionId)?.cancel();
    const handle = mux.openStream(
      "session/follow",
      { args: { request: { address: { kind: "session", sessionId } } } },
      {
        onItem: (value) => {
          const item = value as
            | { type: "snapshot"; records: readonly unknown[]; header?: { cwd?: string }; projections?: { asOfSeq: number; values: Record<string, unknown> } }
            | { type: "event"; event: { type: string; seq: number } };
          if (item.type === "snapshot") {
            this.followState.set(sessionId, {
              cancel: handle.cancel,
              snapshotSeen: true,
            });
            this.options.onLog?.(
              `[session/follow ${sessionId}] snapshot: records=${item.records.length} cursor=${(item as { cursor?: number }).cursor ?? "?"} projectionKeys=${item.projections ? Object.keys(item.projections.values).join(",") : "none"}`,
            );
            onSnapshot(item);
            return;
          }
          // Synthesize a mux frame for the live event.
          this.emit("mux", {
            payload: { type: "session/event", sessionId, event: item.event },
          });
        },
        onEnd: () => {
          this.followState.delete(sessionId);
        },
        onError: (failure: RemoteStreamFailure) => {
          this.followState.delete(sessionId);
          this.options.onLog?.(
            `[session/follow ${sessionId}] ${failure.message}`,
          );
        },
      },
    );
    this.followState.set(sessionId, {
      cancel: handle.cancel,
      snapshotSeen: false,
    });
    return handle.cancel;
  }

  /**
   * Open the `session/control` logical stream. Each item is a
   * `SessionControlFrame` (baseline/queue/jobs/projection). Items are
   * forwarded as `control` events. Returns a disposer.
   */
  openSessionControl(
    onFrame: (frame: ControlFrame) => void,
  ): () => void {
    const mux = this.mux;
    if (!mux) throw new Error("dsh web 尚未就绪");
    const handle = mux.openStream(
      "session/control",
      { args: {} },
      {
        onItem: (value) => {
          onFrame({ payload: value });
        },
        onEnd: () => undefined,
        onError: (failure: RemoteStreamFailure) => {
          this.options.onLog?.(`[session/control] ${failure.message}`);
        },
      },
    );
    return handle.cancel;
  }

  /**
   * Open the `workspace/follow` logical stream. Each item is a
   * `WorkspaceFollowFrame` (baseline/upsert/remove/order/archived). Items are
   * forwarded as `workspace` events. Returns a disposer.
   */
  openWorkspaceFollow(
    onFrame: (frame: WorkspaceFrame) => void,
  ): () => void {
    const mux = this.mux;
    if (!mux) throw new Error("dsh web 尚未就绪");
    const handle = mux.openStream(
      "workspace/follow",
      { args: {} },
      {
        onItem: (value) => {
          onFrame({ payload: value });
        },
        onEnd: () => undefined,
        onError: (failure: RemoteStreamFailure) => {
          this.options.onLog?.(`[workspace/follow] ${failure.message}`);
        },
      },
    );
    return handle.cancel;
  }

  private onGenerationClosed(generation: number): void {
    if (this.stopping || generation !== this.generation) return;
    this.generation += 1;
    this.closeTransport();
    this.emit("muxClose");
    this.setStatus("reconnecting");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openGeneration().then(
        () => this.setStatus("ready"),
        (error: unknown) => {
          this.options.onLog?.(
            `dsh 重连失败: ${error instanceof Error ? error.message : String(error)}`,
          );
          this.scheduleReconnect();
        },
      );
    }, 1_000);
  }

  private closeTransport(): void {
    const mux = this.mux;
    this.mux = null;
    this.wire = null;
    this.eventsClientId = null;
    this.waterfalls.clear();
    for (const cancel of this.streamCancellers.values()) cancel();
    this.streamCancellers.clear();
    this.followState.clear();
    mux?.stop();
  }

  private async releaseTarget(): Promise<void> {
    const lease = this.brokerLease;
    this.brokerLease = null;
    lease?.dispose();
  }
}

/**
 * Map a forwarded `$events` event name to the extension's existing
 * `host/<event>` frame method surface. New event names that have no existing
 * host/* mapping pass through as `host/<event>` so downstream wiring can be
 * added incrementally.
 */
function mapEventToHostMethod(event: string): string {
  switch (event) {
    case "api-session/status":
      return "host/session-status";
    case "api-session/added":
      return "host/session-added";
    case "api-session/removed":
      return "host/session-removed";
    case "api-session/error":
      return "host/agent-error";
    case "api-session/activity":
      return "host/session-activity";
    case "commands/change":
    case "agent-preset/selected":
    case "settings/document-updated":
    case "llm/adapters-updated":
    case "credentials/reference-updated":
      return "host/remote-event";
    default:
      return `host/${event}`;
  }
}
