/**
 * ConversationService 历史分页测试（M2 + loadOlder）：
 *   - applySnapshot 从 session/follow 快照种窗口并记录 hasMore；
 *   - loadOlder 经 session/page beforeSeq 向前翻页并前置合并（seq 去重）；
 *   - 并发 live 帧在 fetch 期间缓冲（pending）并在完成后合并；
 *   - 重 applySnapshot 不丢已加载的更早事件；
 *   - hasMore=false / loadingOlder 期间的重复 loadOlder 为 no-op。
 */

import { describe, expect, it, vi } from "vitest";
import {
  ConversationService,
  type FollowSnapshot,
  type HistoryPage,
} from "../src/services/conversation-service.ts";
import type { WireSessionEvent } from "../src/conversation/fold.ts";
import type { WireClient } from "../src/dsh/wire.ts";

/** 一条可折叠为 user 气泡的最小事件。 */
function userEvent(seq: number, text: string): WireSessionEvent {
  return {
    type: "user/message",
    seq,
    time: seq * 1000,
    data: { content: [{ type: "text", text }] },
  };
}

/** 按 seq 升序返回的多条 user 事件。 */
function userEvents(seqs: number[]): WireSessionEvent[] {
  return seqs.map((seq) => userEvent(seq, `message-${seq}`));
}

/** Build a session/follow snapshot from events. */
function snapshot(
  events: WireSessionEvent[],
  hasMore: boolean,
  cursor = 10,
): FollowSnapshot {
  return {
    type: "snapshot",
    header: { id: "s1" },
    cursor,
    records: events.map((event) => ({ type: "event", event })),
    hasMore,
  };
}

/** Build a session/page response from events. */
function page(events: WireSessionEvent[], hasMore: boolean): HistoryPage {
  return {
    records: events.map((event) => ({ type: "event", event })),
    hasMore,
  };
}

/** 一个可编程的 fake WireClient：按 method+args 匹配返回历史页。 */
function fakeClient(
  respond: (method: string, args: unknown) => Promise<HistoryPage>,
) {
  const call = vi.fn(
    (method: string, args: unknown) => respond(method, args),
  );
  return {
    call,
    client: { call } as unknown as WireClient,
  };
}

/** A synthesized mux frame (DshService emits these from session/follow items). */
function frame(
  sessionId: string,
  event: WireSessionEvent,
): { payload: unknown } {
  return {
    payload: { type: "session/event", sessionId, event },
  };
}

function userTexts(snapshot: { items: { kind: string; text?: string }[] }): string[] {
  return snapshot.items
    .filter((item) => item.kind === "user")
    .map((item) => item.text ?? "");
}

describe("ConversationService history pagination", () => {
  it("applySnapshot seeds the tail window and records hasMore", () => {
    const { client } = fakeClient(async () => page([], false));
    const service = new ConversationService(() => client);

    const snap = service.applySnapshot("s1", snapshot(userEvents([8, 9, 10]), true));

    expect(userTexts(snap)).toEqual(["message-8", "message-9", "message-10"]);
    expect(snap.lastSeq).toBe(10);
    expect(snap.hasMore).toBe(true);
  });

  it("loadOlder prepends the previous page via beforeSeq and updates hasMore", async () => {
    const { call, client } = fakeClient(async (_method, args) => {
      const req = args as { request?: { beforeSeq?: number } };
      if (req.request && "beforeSeq" in req.request) {
        return page(userEvents([5, 6, 7]), false);
      }
      return page([], false);
    });
    const service = new ConversationService(() => client);
    service.applySnapshot("s1", snapshot(userEvents([8, 9, 10]), true, 10));

    const snap = await service.loadOlder("s1");

    expect(userTexts(snap)).toEqual([
      "message-5",
      "message-6",
      "message-7",
      "message-8",
      "message-9",
      "message-10",
    ]);
    expect(snap.lastSeq).toBe(10);
    expect(snap.hasMore).toBe(false);
    expect(call).toHaveBeenCalledWith("session/page", {
      request: {
        address: { kind: "session", sessionId: "s1" },
        throughSeq: 10,
        beforeSeq: 8,
      },
    });
  });

  it("loadOlder is a no-op when the window is complete", async () => {
    const { call, client } = fakeClient(async () => page([], false));
    const service = new ConversationService(() => client);
    service.applySnapshot("s1", snapshot(userEvents([1, 2]), false, 2));
    const before = call.mock.calls.length;

    const snap = await service.loadOlder("s1");

    expect(call.mock.calls.length).toBe(before); // 不再发 RPC
    expect(userTexts(snap)).toEqual(["message-1", "message-2"]);
  });

  it("guards against concurrent loadOlder calls (loadingOlder flag)", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { call, client } = fakeClient(async (_method, args) => {
      const req = args as { request?: { beforeSeq?: number } };
      if (req.request && "beforeSeq" in req.request) {
        await gate; // 挂起第一次翻页
        return page(userEvents([1, 2]), false);
      }
      return page([], false);
    });
    const service = new ConversationService(() => client);
    service.applySnapshot("s1", snapshot(userEvents([3, 4]), true, 4));

    const first = service.loadOlder("s1");
    const second = await service.loadOlder("s1"); // 应立刻返回，不再发 RPC

    expect(userTexts(second)).toEqual(["message-3", "message-4"]);
    const pageCalls = call.mock.calls.filter(
      ([method]) => method === "session/page",
    );
    expect(pageCalls.length).toBe(1); // 仅一次 loadOlder
    release?.();
    const settled = await first;
    expect(userTexts(settled)).toEqual([
      "message-1",
      "message-2",
      "message-3",
      "message-4",
    ]);
  });

  it("drains live frames buffered during a loadOlder fetch", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { client } = fakeClient(async (_method, args) => {
      const req = args as { request?: { beforeSeq?: number } };
      if (req.request && "beforeSeq" in req.request) {
        await gate;
        return page(userEvents([1, 2]), false);
      }
      return page([], false);
    });
    const service = new ConversationService(() => client);
    service.applySnapshot("s1", snapshot(userEvents([3, 4]), true, 4));

    const loading = service.loadOlder("s1");
    // 翻页期间的并发 live 帧进入 pending 缓冲。
    service.applyFrame(frame("s1", userEvent(5, "message-5")));
    service.applyFrame(frame("s1", userEvent(4, "message-4-dup"))); // 已覆盖 → 丢弃
    release?.();
    const snap = await loading;

    expect(userTexts(snap)).toEqual([
      "message-1",
      "message-2",
      "message-3",
      "message-4",
      "message-5",
    ]);
    expect(snap.lastSeq).toBe(5);
  });

  it("re-applySnapshot preserves events loaded from older pages (resync-safe)", async () => {
    const { client } = fakeClient(async (_method, args) => {
      const req = args as { request?: { beforeSeq?: number } };
      if (req.request && "beforeSeq" in req.request) {
        return page(userEvents([1, 2, 3]), true);
      }
      return page([], false);
    });
    const service = new ConversationService(() => client);
    service.applySnapshot("s1", snapshot(userEvents([4, 5, 6]), true, 6));
    await service.loadOlder("s1");

    // 重连 resync：快照重放不得让已加载的更早消息消失。
    service.applySnapshot("s1", snapshot(userEvents([4, 5, 6]), true, 6));
    const snap = service.snapshot("s1");

    expect(userTexts(snap!)).toEqual([
      "message-1",
      "message-2",
      "message-3",
      "message-4",
      "message-5",
      "message-6",
    ]);
  });

  it("applySnapshot merges overlapping pages by seq without duplicating items", async () => {
    const { client } = fakeClient(async (_method, args) => {
      const req = args as { request?: { beforeSeq?: number } };
      if (req.request && "beforeSeq" in req.request) {
        return page(userEvents([5, 6, 7, 8]), false);
      }
      return page([], false);
    });
    const service = new ConversationService(() => client);
    service.applySnapshot("s1", snapshot(userEvents([8, 9, 10]), true, 10));
    const snap = await service.loadOlder("s1");

    // seq 8 重叠：只保留一份。
    expect(userTexts(snap)).toEqual([
      "message-5",
      "message-6",
      "message-7",
      "message-8",
      "message-9",
      "message-10",
    ]);
  });

  it("applies live frames to an attached window and emits change", () => {
    const { client } = fakeClient(async () => page([], false));
    const service = new ConversationService(() => client);
    service.applySnapshot("s1", snapshot(userEvents([1]), true, 1));
    const onChange = vi.fn();
    service.on("change", onChange);

    service.applyFrame(frame("s1", userEvent(2, "message-2")));
    service.applyFrame(frame("s1", userEvent(2, "message-2-stale"))); // 同 seq → 丢弃

    const snap = service.snapshot("s1")!;
    expect(userTexts(snap)).toEqual(["message-1", "message-2"]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps agent-error notes alongside the pagination flag", () => {
    const { client } = fakeClient(async () => page([], false));
    const service = new ConversationService(() => client);
    service.applySnapshot("s1", snapshot(userEvents([1]), true, 1));
    service.applyAgentError("s1", "boom");

    const snap = service.snapshot("s1")!;

    expect(snap.hasMore).toBe(true);
    expect(snap.items.at(-1)).toEqual({
      kind: "note",
      text: "会话出错：boom",
    });
  });

  it("snapshot returns null before applySnapshot", () => {
    const { client } = fakeClient(async () => page([], false));
    const service = new ConversationService(() => client);

    expect(service.snapshot("unattached")).toBeNull();
  });
});
