/**
 * DSH endpoint recognition. A usable endpoint accepts the multiplexed
 * `/api/remote.mux` WebSocket and delivers the `$events` logical stream's
 * opening `ready` item, which carries the Host home path used for display.
 * There is no `host.describe` RPC in dsh 0.1.2+; the ready frame is the
 * generation source and the sole Host-facts carrier.
 */

import { connect } from "node:net";
import { WebSocket } from "ws";
import {
  RemoteStreamMux,
  REMOTE_EVENT_STREAM_ENDPOINT,
  REMOTE_EVENT_STREAM_PAYLOAD,
  type RemoteStreamFailure,
} from "./wire.ts";

/** Host facts published by the `$events` ready frame. */
export interface DshHostDescription {
  /** Host account home used to abbreviate displayed filesystem paths. */
  home: string;
}

export type DshProbeResult =
  | { kind: "dsh"; baseUrl: string; description: DshHostDescription }
  | { kind: "not-dsh"; baseUrl: string; reason: string };

export function normalizeDshBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`DSH 地址无效: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`DSH 地址只支持 http/https: ${raw}`);
  }
  if (url.username || url.password)
    throw new Error("DSH 地址不能包含用户名或密码");
  if (url.search || url.hash) throw new Error("DSH 地址不能包含查询参数或片段");
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("DSH 地址必须指向服务根路径");
  }
  url.pathname = "";
  return url.toString().replace(/\/$/u, "");
}

export function loopbackDshUrl(port: number): string {
  assertPort(port);
  return `http://127.0.0.1:${String(port)}`;
}

export function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`DSH 端口必须是 1 到 65535 的整数，收到: ${String(port)}`);
  }
}

/**
 * Recognize a live DSH instance by opening `/api/remote.mux` and the
 * `$events` logical stream, then awaiting the `ready` item.
 */
export async function probeDsh(
  baseUrlInput: string,
  timeoutMs = 3_000,
  cookie?: string,
): Promise<DshProbeResult> {
  const baseUrl = normalizeDshBaseUrl(baseUrlInput);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const description = await probeEvents(baseUrl, abort.signal, cookie);
    if (!description) {
      return {
        kind: "not-dsh",
        baseUrl,
        reason: "$events ready 帧结构不符合 DSH 契约",
      };
    }
    return { kind: "dsh", baseUrl, description };
  } catch (error) {
    return {
      kind: "not-dsh",
      baseUrl,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Open `/api/remote.mux` + `$events` and await the `ready` item. Resolves
 * with the Host home, or null when the ready item is malformed.
 */
async function probeEvents(
  baseUrl: string,
  signal: AbortSignal,
  cookie?: string,
): Promise<DshHostDescription | null> {
  const wsBase = baseUrl.replace(/^http:/u, "ws:").replace(/^https:/u, "wss:");
  const mux = new RemoteStreamMux(
    {
      url: `${wsBase}/api/remote.mux`,
      ...(cookie === undefined ? {} : { cookie }),
    },
    WebSocket,
  );
  const ready = new Promise<DshHostDescription | null>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      reject(new Error("DSH 探测超时"));
    };
    const onOpen = (): void => {
      // Physical socket open; the $events stream open is sent by openStream.
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(new Error(`DSH WebSocket 握手失败: ${error.message}`));
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error("DSH WebSocket 在就绪前关闭"));
    };
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
      mux.off("open", onOpen);
      mux.off("error", onError);
      mux.off("close", onClose);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    mux.once("open", onOpen);
    mux.once("error", onError);
    mux.once("close", onClose);
    // Open the $events logical stream; the first item is the ready frame.
    mux.openStream(REMOTE_EVENT_STREAM_ENDPOINT, REMOTE_EVENT_STREAM_PAYLOAD, {
      onItem: (value) => {
        cleanup();
        const ready = parseReadyFrame(value);
        resolve(ready);
      },
      onEnd: () => {
        cleanup();
        reject(new Error("$events 流在 ready 前结束"));
      },
      onError: (failure: RemoteStreamFailure) => {
        cleanup();
        reject(new Error(`$events 流错误: ${failure.message}`));
      },
    });
  });
  mux.start();
  try {
    return await ready;
  } finally {
    mux.stop();
  }
}

/**
 * Parse the `$events` ready item: `{ type:'ready', clientId, host:{ home } }`.
 * Returns null when the structure does not match.
 */
function parseReadyFrame(value: unknown): DshHostDescription | null {
  if (value === null || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.type !== "ready") return null;
  const host = row.host as Record<string, unknown> | undefined;
  if (!host || typeof host.home !== "string") return null;
  return { home: host.home };
}

/** True when something accepts TCP connections at this host/port. */
export async function isTcpPortOccupied(
  host: string,
  port: number,
  timeoutMs = 800,
): Promise<boolean> {
  assertPort(port);
  return await new Promise((resolve) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}
