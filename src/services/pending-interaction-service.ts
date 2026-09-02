/**
 * PendingInteractionService (M4): the pending-interaction closed loop —
 * approval / ask-user / plan-review minimal dialogs. Mirrors the reference
 * client's PendingWait list: one per-session Map keyed `a:<approvalId>` /
 * `q:<eventId>`, fed from `$events` waterfall frames (approval/request and
 * user-questions/request), settled by the Host's waterfall resolution (the
 * Host cancels the pending delivery when the agent's turn ends). The
 * eventId stays inside the extension host: webview answers carry the opaque
 * key, this service backfills the eventId and calls DshService.answerWaterfall.
 *
 * plan-review is not a separate event: it is an AskUserQuestionItem whose
 * `intent.kind === 'plan-review'` — narrowed here exactly like the reference
 * `planReviewOf` (single question, not multiSelect, options contain the
 * approve label and at most one other option), falling back to the generic
 * question flow otherwise.
 */

import { EventEmitter } from "node:events";
import type { WaterfallFrame } from "./dsh-service.ts";
import type {
  PendingAnswer,
  PendingItemView,
  PendingQuestionView,
} from "../shared/protocol.ts";

/** 一个 question 的 wire 原始形态（AskUserQuestionItem 结构镜像；数据留在此层）。 */
interface WireQuestion {
  id: string;
  question: string;
  detail?: string;
  header?: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
  intent?: { kind: "plan-review"; approve: string };
}

interface PendingEntry {
  key: string;
  sessionId: string;
  eventId: string;
  view: PendingItemView;
}

export class PendingInteractionService extends EventEmitter {
  private readonly entries = new Map<string, PendingEntry>();
  private readonly answerWaterfall: (
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
  ) => Promise<void>;

  constructor(
    answerWaterfall: (
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
    ) => Promise<void>,
  ) {
    super();
    this.answerWaterfall = answerWaterfall;
  }

  /** The pending views for a session, oldest-first (Map insertion order). */
  snapshot(sessionId: string): PendingItemView[] {
    const views: PendingItemView[] = [];
    for (const entry of this.entries.values()) {
      if (entry.sessionId === sessionId) views.push(entry.view);
    }
    return views;
  }

  /** Route one `$events` waterfall frame into the pending map. */
  applyWaterfall(frame: WaterfallFrame): void {
    if (frame.event === "approval/request") {
      const request = frame.request as {
        agent?: { session?: { id: string } };
        toolName?: string;
        callId?: string;
        reason?: string;
      };
      const sessionId = request.agent?.session?.id ?? frame.agentId;
      const approvalId = frame.eventId;
      const key = `a:${approvalId}`;
      const view: PendingItemView = {
        kind: "approval",
        key,
        toolName: request.toolName ?? "",
        ...(request.reason !== undefined ? { reason: request.reason } : {}),
        ...(request.callId !== undefined ? { callId: request.callId } : {}),
      };
      this.upsert(key, sessionId, frame.eventId, view);
      return;
    }
    if (frame.event === "user-questions/request") {
      const request = frame.request as {
        agent?: { session?: { id: string } };
        questions?: WireQuestion[];
      };
      const sessionId = request.agent?.session?.id ?? frame.agentId;
      const key = `q:${frame.eventId}`;
      const view = narrowQuestions(key, request.questions ?? []);
      this.upsert(key, sessionId, frame.eventId, view);
      return;
    }
  }

  /** Route a waterfall cancellation (Host settled the delivery). */
  applyWaterfallCancel(eventId: string): void {
    // Approval keys use the eventId directly; question keys use the eventId.
    this.settle(`a:${eventId}`);
    this.settle(`q:${eventId}`);
  }

  /**
   * Answer a pending interaction. approval answers the wire outcome;
   * question/plan-review answers the structured answer batch. Returns when
   * the `$events/result` RPC completes.
   */
  async answer(
    sessionId: string,
    key: string,
    answer: PendingAnswer,
  ): Promise<void> {
    const entry = this.requireEntry(sessionId, key);
    if (answer.kind === "approval") {
      await this.answerWaterfall(entry.eventId, {
        kind: "result",
        value: {
          sessionId,
          approvalId: key.slice(2),
          outcome: answer.outcome,
        },
      });
      return;
    }
    await this.answerWaterfall(entry.eventId, {
      kind: "result",
      value: {
        sessionId,
        answer: { answers: answer.answers },
      },
    });
  }

  /** Cancel a pending question/plan-review (= rejected error; approval has no client cancel). */
  async cancel(sessionId: string, key: string): Promise<void> {
    const entry = this.requireEntry(sessionId, key);
    if (entry.view.kind === "approval") {
      throw new Error(
        "审批请求没有取消出口（wire 仅 allowed-once/rejected 两结局）",
      );
    }
    await this.answerWaterfall(entry.eventId, {
      kind: "rejected",
      error: {
        name: "Cancelled",
        message: "the user closed this question request",
        code: "cancelled",
      },
    });
  }

  private upsert(
    key: string,
    sessionId: string,
    eventId: string,
    view: PendingItemView,
  ): void {
    // Replay of the same eventId refreshes the payload in place (Map.set keeps
    // insertion order — oldest-first preserved); still notify so the webview
    // re-renders the (possibly refreshed) card, but never a duplicate entry.
    this.entries.set(key, { key, sessionId, eventId, view });
    this.emit("change", sessionId);
  }

  /** Frame-driven settlement: the authoritative cancel removes the wait. */
  private settle(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.emit("change", entry.sessionId);
  }

  private requireEntry(sessionId: string, key: string): PendingEntry {
    const entry = this.entries.get(key);
    if (!entry || entry.sessionId !== sessionId)
      throw new Error("待应答交互不存在或已结算");
    return entry;
  }
}

/**
 * 收窄 question 请求为可渲染视图：plan-review 决策卡当且仅当单问题 + 声明
 * plan-review intent + detail 即计划正文 + 选项含 approve label 且至多一个
 * 其它选项 + 非多选（对齐参考 planReviewOf——第三方选项或多选批次是两按钮表达
 * 不了的，退回通用问询，保证每个请求都可应答）。
 */
function narrowQuestions(
  key: string,
  questions: WireQuestion[],
): PendingItemView {
  const review = planReviewOf(questions);
  if (review) return { kind: "plan-review", key, ...review };
  return {
    kind: "question",
    key,
    items: questions.map((q): PendingQuestionView => {
      const view: PendingQuestionView = {
        id: q.id,
        question: q.question,
        ...(q.detail !== undefined ? { detail: q.detail } : {}),
        ...(q.header !== undefined ? { header: q.header } : {}),
        ...(q.multiSelect === true ? { multiSelect: true } : {}),
        ...(q.options !== undefined && q.options.length > 0
          ? { options: q.options }
          : {}),
      };
      return view;
    }),
  };
}

function planReviewOf(
  questions: WireQuestion[],
): Omit<
  Extract<PendingItemView, { kind: "plan-review" }>,
  "kind" | "key"
> | null {
  if (questions.length !== 1) return null;
  const q = questions[0];
  if (q === undefined) return null;
  if (q.intent?.kind !== "plan-review") return null;
  if (q.detail === undefined) return null;
  if (q.multiSelect === true) return null;
  const options = q.options ?? [];
  const approve = options.find((o) => o.label === q.intent?.approve);
  if (approve === undefined) return null;
  const others = options.filter((o) => o !== approve);
  if (others.length > 1) return null;
  return {
    id: q.id,
    question: q.question,
    plan: q.detail,
    approve: approve.label,
    ...(others.length === 1 ? { decline: others[0]!.label } : {}),
  };
}
