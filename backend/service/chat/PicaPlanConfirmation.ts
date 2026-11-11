import { createHash } from "node:crypto";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { ChatConfirmationWord } from "@/definition/Chat";
import type { ChatActionRequest } from "./ChatToolExecutor";

interface PendingDeletion {
  readonly fingerprint: string;
  readonly runId: string;
  readonly expiresAt: number;
}

/** Server-owned human text, passed separately from the model prompt and attachments. */
export interface PicaPlanTurn {
  readonly id?: string;
  readonly message: string;
  readonly confirmation: ChatConfirmationWord | null;
}

function canonical(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(canonical);
  if (typeof input !== "object" || input === null) return input;
  return Object.fromEntries(
    Object.entries(input)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]),
  );
}

function isExplicitConsent(message: string): boolean {
  return /^(?:ja|yes|confirm|bestätig(?:e|t|en)|bitte\s+löschen|lösche|delete|remove|entferne)(?:\b|[.!?,\s])/iu.test(
    message.trim(),
  );
}

/** Builds a stable operation key for identical native plan calls within the same server turn. */
export function picaPlanOperationId(
  action: ChatActionRequest,
  context: RuntimeExecutionContext,
  turnId = context.runId,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        context.userId,
        context.sessionId,
        turnId,
        action.operation,
        canonical(action.parameters),
      ]),
    )
    .digest("hex");
}

/** Binds a later explicit reply to one exact server-recorded request. */
export class PicaPlanConfirmation {
  private readonly pending = new Map<string, PendingDeletion>();
  private readonly approved = new Map<string, number>();

  /** Keeps a lost acknowledgement replayable within the already approved exact human turn. */
  public hasApproval(
    action: ChatActionRequest,
    context: RuntimeExecutionContext,
    turn: PicaPlanTurn,
  ): boolean {
    const key = picaPlanOperationId(action, context, turn.id ?? context.runId);
    return (this.approved.get(key) ?? 0) > Date.now();
  }

  /** A model cannot supply consent, change its target, or consume a confirmation in the asking turn. */
  public consume(
    action: ChatActionRequest,
    context: RuntimeExecutionContext,
    turn: PicaPlanTurn,
  ): boolean {
    const now = Date.now();
    for (const [key, entry] of this.pending)
      if (entry.expiresAt <= now) this.pending.delete(key);
    for (const [key, expiresAt] of this.approved)
      if (expiresAt <= now) this.approved.delete(key);
    const turnId = turn.id ?? context.runId;
    const approvalKey = picaPlanOperationId(action, context, turnId);
    if (this.approved.has(approvalKey)) return true;
    const key = JSON.stringify([context.userId, context.sessionId]);
    const fingerprint = JSON.stringify([
      action.operation,
      canonical(action.parameters),
    ]);
    const pending = this.pending.get(key);
    if (
      pending?.fingerprint === fingerprint &&
      pending.runId !== turnId &&
      isExplicitConsent(turn.message)
    ) {
      this.pending.delete(key);
      this.approved.set(approvalKey, now + 600_000);
      return true;
    }
    if (pending?.runId === turnId) return false;
    if (this.pending.size >= 1000 && !pending) return false;
    this.pending.set(key, {
      fingerprint,
      runId: turnId,
      expiresAt: now + 600_000,
    });
    return false;
  }
}
