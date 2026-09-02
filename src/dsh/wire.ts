/**
 * Wire client for dsh 0.1.2+ (Typert Remote gateway).
 *
 * Two transports:
 *   1. HTTP RPC: POST /api/<namespace>/<method> with a Connection
 *      `client-request` envelope whose `payload` is `{ args: {...} }`. The
 *      response is a `server-response` envelope with `result.ok` and a value
 *      or `{ code, message, details }` error.
 *   2. One multiplexed WebSocket `/api/remote.mux` carrying independent
 *      logical streams (`$events`, `session/follow`, `session/control`,
 *      `workspace/follow`). Each logical stream is opened with an
 *      `{ type:'open', streamId, endpoint, payload }` text frame and receives
 *      `item`/`end`/`error` frames back on the same physical socket.
 *
 * Envelope shapes mirror `@deepseek-ai/dsh-client-connection` (rpc.ts) and
 * `@deepseek-ai/dsh-api-gateway` (stream-protocol.ts); business payloads stay
 * untyped at this layer (schema validation happens through the runtime schema
 * anchor, see schemas.ts — contract following).
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { WebSocket as WsWebSocket } from "ws";

// ---- Connection RPC envelopes (dsh-client-connection/rpc.ts mirror) ----

export interface ClientRequest {
  type: "client-request";
  rpcId: string;
  method: string;
  payload: unknown;
}

export interface ServerResponse {
  type: "server-response";
  rpcId: string;
  result: RpcResult<unknown>;
}

export type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RpcError };

export interface RpcError {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

/** Error thrown for a business failure (`result.ok === false`). */
export class DshRpcError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(error: RpcError) {
    super(error.message);
    this.name = "DshRpcError";
    this.code = error.code;
    this.details = error.details;
  }
}

/** Optional envelope validator (schema-anchor backed); absent = structural only. */
export interface EnvelopeValidator {
  /** Validate a full wire message; return false to drop/reject it. */
  validateServerResponse(value: unknown): boolean;
  validateServerRequest(value: unknown): boolean;
  /** Validate a Remote stream server frame (`item`/`end`/`error`). */
  validateStreamFrame?(value: unknown): boolean;
}

// ---- Remote stream wire frames (dsh-api-gateway/stream-protocol.ts mirror) ----

/** One logical-stream request sent from the client to the Host. */
export type RemoteStreamClientMessage =
  | {
      type: "open";
      streamId: string;
      endpoint: string;
      payload: unknown;
    }
  | { type: "cancel"; streamId: string };

/** One logical-stream frame sent from the Host to the client. */
export type RemoteStreamServerMessage =
  | { type: "item"; streamId: string; value?: unknown }
  | { type: "error"; streamId: string; error: RemoteStreamFailure }
  | { type: "end"; streamId: string };

export interface RemoteStreamFailure {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

/** Gateway-internal endpoints (stream-protocol.ts constants). */
export const REMOTE_EVENT_STREAM_ENDPOINT = "$events";
export const REMOTE_EVENT_RESULT_ENDPOINT = "$events/result";
export const REMOTE_EVENT_STREAM_PAYLOAD = { args: {} } as const;

// ---- HTTP RPC client ----

/** HTTP RPC client for one dsh web base URL. */
export class WireClient {
  private readonly baseUrl: string;
  private readonly validator?: EnvelopeValidator;
  private readonly cookie?: string;

  constructor(baseUrl: string, validator?: EnvelopeValidator, cookie?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/u, "");
    this.validator = validator;
    this.cookie = cookie;
  }

  /**
   * POST /api/<method> with a client-request envelope whose payload is
   * `{ args: {...} }`; awaits the matching server-response.
   *
   * The `method` is the full Remote endpoint including namespace, e.g.
   * `"session/list"`, `"workspace/create"`, `"settings/describe"`. The
   * `args` object carries the named parameters of that Remote method.
   * @throws DshRpcError on business failure, Error on transport/parse failure.
   */
  async call<T>(
    method: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const rpcId = randomUUID();
    const body: ClientRequest = {
      type: "client-request",
      rpcId,
      method,
      payload: { args },
    };
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/${method}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.cookie === undefined ? {} : { cookie: this.cookie }),
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw new Error(
        `dsh web RPC ${method} 传输失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      // HTTP status is carrier-only; business errors arrive as 200.
      throw new Error(
        `dsh web RPC ${method} 载体错误: HTTP ${response.status}`,
      );
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new Error(`dsh web RPC ${method} 响应不是 JSON`);
    }
    if (this.validator && !this.validator.validateServerResponse(parsed)) {
      throw new Error(`dsh web RPC ${method} 响应未通过运行时 schema 校验`);
    }
    const message = parsed as ServerResponse;
    if (message.type !== "server-response" || message.rpcId !== rpcId) {
      throw new Error(
        `dsh web RPC ${method} 响应信封不匹配 (type=${message.type as string})`,
      );
    }
    if (message.result.ok) return message.result.value as T;
    throw new DshRpcError(message.result.error);
  }

  /**
   * Answer one `$events` waterfall delivery (approval/request or
   * user-questions/request) through the `$events/result` Remote RPC.
   * The `clientId`/`eventId` come from the waterfall frame; the outcome is
   * `{ kind:'next' }`, `{ kind:'result', value? }`, or
   * `{ kind:'rejected', error }`.
   */
  async answerRemoteEvent(
    clientId: string,
    eventId: string,
    outcome: RemoteEventOutcome,
  ): Promise<void> {
    await this.call<unknown>(REMOTE_EVENT_RESULT_ENDPOINT, {
      clientId,
      eventId,
      outcome,
    });
  }
}

/** One Client response to a Host waterfall delivery. */
export type RemoteEventOutcome =
  | { kind: "next" }
  | { kind: "result"; value?: unknown }
  | {
      kind: "rejected";
      error: { name: string; message: string; code?: string; details?: unknown };
    };

// ---- Multiplexed Remote stream WebSocket (/api/remote.mux) ----

/**
 * One multiplexed Remote stream WebSocket. The physical socket is shared by
 * many independent logical streams, each opened with an `open` message
 * carrying a fresh `streamId` and the Gateway endpoint name (e.g.
 * `$events`, `session/follow`). The Host replies with `item` frames
 * (stream values), a terminal `end` frame, or an `error` frame.
 *
 * Reconnects the physical socket with a fixed backoff; logical streams
 * survive a reconnect by reopening themselves through `onReopen`. Emits
 * `open` when the physical socket is (re)established, `frame` per logical
 * stream item, `end` per logical stream completion, `streamError` per
 * logical stream failure, and `close` when the physical socket drops.
 */
export class RemoteStreamMux extends EventEmitter {
  private readonly url: string;
  private readonly validator?: EnvelopeValidator;
  private readonly reconnectMs: number;
  private readonly cookie?: string;
  private socket: WsWebSocket | null = null;
  private closed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly ws: new (url: string, options?: { headers?: Record<string, string> }) => WsWebSocket;
  /** Logical streams awaiting their opening frame after a (re)connect. */
  private readonly pendingOpens = new Map<
    string,
    { endpoint: string; payload: unknown }
  >();
  /** Active logical stream listeners. */
  private readonly streams = new Map<
    string,
    {
      onItem: (value: unknown) => void;
      onEnd: () => void;
      onError: (failure: RemoteStreamFailure) => void;
    }
  >();

  constructor(
    options: {
      url: string;
      validator?: EnvelopeValidator;
      reconnectMs?: number;
      cookie?: string;
    },
    wsImpl: new (url: string, options?: { headers?: Record<string, string> }) => WsWebSocket,
  ) {
    super();
    this.url = options.url;
    this.validator = options.validator;
    this.reconnectMs = options.reconnectMs ?? 1_000;
    this.cookie = options.cookie;
    this.ws = wsImpl;
  }

  /** Open the physical socket (idempotent; reconnects automatically until stop()). */
  start(): void {
    if (this.closed || this.socket) return;
    this.connect();
  }

  /** Close the physical socket and all logical streams; stop reconnecting. */
  stop(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
    this.failAllStreams(new Error("Remote stream mux closed"));
    this.pendingOpens.clear();
    this.streams.clear();
  }

  /**
   * Open one logical stream. Resolves when the Host acknowledges the open
   * (the first `item`/`end`/`error` frame for this streamId arrives). The
   * `onItem`/`onEnd`/`onError` callbacks receive subsequent frames. The
   * returned disposer cancels the logical stream (sends `cancel` and removes
   * the listener).
   */
  openStream(
    endpoint: string,
    payload: unknown,
    handlers: {
      onItem: (value: unknown) => void;
      onEnd: () => void;
      onError: (failure: RemoteStreamFailure) => void;
    },
  ): { streamId: string; cancel: () => void } {
    const streamId = randomUUID();
    this.streams.set(streamId, handlers);
    this.pendingOpens.set(streamId, { endpoint, payload });
    this.sendOpen(streamId, endpoint, payload);
    return {
      streamId,
      cancel: (): void => {
        this.streams.delete(streamId);
        this.pendingOpens.delete(streamId);
        this.send({ type: "cancel", streamId });
      },
    };
  }

  private sendOpen(streamId: string, endpoint: string, payload: unknown): void {
    if (this.socket?.readyState === this.socket?.OPEN) {
      this.send({ type: "open", streamId, endpoint, payload });
    }
    // If the socket is not open yet, the pendingOpens entry will be flushed
    // when the (re)connect completes.
  }

  private send(message: RemoteStreamClientMessage): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify(message));
  }

  private connect(): void {
    const socket = new this.ws(this.url, {
      ...(this.cookie === undefined
        ? {}
        : { headers: { cookie: this.cookie } }),
    });
    this.socket = socket;
    socket.onopen = () => {
      // Flush any pending opens (streams requested before the socket opened).
      for (const [streamId, { endpoint, payload }] of this.pendingOpens) {
        this.send({ type: "open", streamId, endpoint, payload });
      }
      this.emit("open");
    };
    socket.onmessage = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        this.emit("error", new Error("Remote stream 帧不是 JSON"));
        return;
      }
      if (
        this.validator?.validateStreamFrame &&
        !this.validator.validateStreamFrame(parsed)
      ) {
        this.emit("error", new Error("Remote stream 帧未通过运行时 schema 校验"));
        return;
      }
      const frame = parsed as RemoteStreamServerMessage;
      const stream = this.streams.get(frame.streamId);
      if (!stream) return; // stream already cancelled or unknown
      this.pendingOpens.delete(frame.streamId);
      if (frame.type === "item") {
        stream.onItem(frame.value);
      } else if (frame.type === "end") {
        stream.onEnd();
        this.streams.delete(frame.streamId);
      } else if (frame.type === "error") {
        stream.onError(frame.error);
        this.streams.delete(frame.streamId);
      }
    };
    socket.onclose = () => {
      this.socket = null;
      this.emit("close");
      if (!this.closed) {
        this.reconnectTimer = setTimeout(
          () => this.connect(),
          this.reconnectMs,
        );
      }
    };
    socket.onerror = () => {
      // onclose follows; nothing to do here besides surfacing.
      this.emit("error", new Error(`Remote stream 连接错误: ${this.url}`));
    };
  }

  /** Fail every active logical stream with the given error (used on close). */
  private failAllStreams(error: Error): void {
    const failure: RemoteStreamFailure = {
      code: "carrier/closed",
      message: error.message,
      details: {},
    };
    for (const [streamId, stream] of [...this.streams]) {
      stream.onError(failure);
      this.streams.delete(streamId);
    }
  }
}
