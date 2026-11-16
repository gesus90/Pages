import { AgentError } from "@/backend/error/AgentErrors";
import { ChatError } from "@/backend/error/ChatErrors";
import { PicaAcpJobError } from "@/backend/error/PicaAcpJobError";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AgentStepFailedError } from "@/backend/error/AgentStepFailedError";
import { AgentToolReadinessError } from "@/backend/service/agents/tools/AgentToolReadinessError";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { logDiagnostic, logEvent } from "@/backend/logging/Logger";
import { CHAT_LIMITS } from "@/definition/Chat";

import type { PlanSessionTurn } from "@/backend/agents/AgentPlanExecution";
import type { DatabaseLogSummary } from "@/backend/logging/DatabaseLogMetrics";
import type {
  ChatJobFailureDetail,
  ChatJobFailureStage,
  ChatJobState,
  ChatJobTurnEvent,
  ChatJobUsage,
  ChatTokenUsage,
} from "@/definition/ChatJob";

/** The terminal state and safe code produced by one Pica job. */
export interface PicaAcpOutcome {
  readonly state: Exclude<ChatJobState, "running">;
  readonly errorCode: string | null;
  /** Where and why a failed job stopped; absent for any other end. */
  readonly detail?: ChatJobFailureDetail;
}

/** The journal entry of a turn that began; a follow-up turn carries its start so its elapsed time is its own. */
export function turnBeganEvent(
  turn: number,
  origin: ChatJobTurnEvent["origin"],
  messageId: string,
): ChatJobTurnEvent {
  return origin === "followUp"
    ? {
        kind: "turn",
        turn,
        origin,
        messageId,
        startedAt: new Date().toISOString(),
      }
    : { kind: "turn", turn, origin, messageId };
}

/**
 * Requires a turn the runner completed.
 * @throws {PicaAcpJobError} With the code of the runner, `timeout` or `providerFailed`.
 */
export function requireCompleted(result: PlanSessionTurn): void {
  if (result.failure === "cancelled" && result.errorCode === null)
    throw new PicaAcpJobError("cancelled");
  if (result.errorCode !== null) throw new PicaAcpJobError(result.errorCode);
  if (result.failure === null) return;
  throw new PicaAcpJobError(
    result.failure === "timeout" ? "timeout" : "providerFailed",
  );
}

/**
 * Reads the answer of a turn as the conversation stores it.
 * @throws {PicaAcpJobError} `invalidOutput` for an empty or too long answer.
 */
export function readAnswer(output: string): string {
  const answer = redactCredentials(output.trim());
  if (!answer || Array.from(answer).length > CHAT_LIMITS.answerCharacters)
    throw new PicaAcpJobError("invalidOutput");
  return answer;
}

/** The stable code of a known failure, or `null` for an unexpected one. */
export function errorCodeOf(error: unknown): string | null {
  if (error instanceof PicaAcpJobError) return error.code;
  if (
    error instanceof AgentError ||
    error instanceof ChatError ||
    error instanceof AgentExecutionError
  )
    return error.code;
  return null;
}

/** Maps cancellation, deadlines and tool exhaustion to the status persisted in the job journal. */
export function picaAcpOutcome(
  error: unknown,
  cancellation: {
    readonly signal: AbortSignal;
    readonly isStopRequested: boolean;
    /** Where the job was when it failed. */
    readonly stage: ChatJobFailureStage;
  },
): PicaAcpOutcome {
  const { signal, isStopRequested, stage } = cancellation;
  if (signal.aborted) {
    if (signal.reason === "stepLimit")
      return { state: "failed", errorCode: "stepLimit" };
    if (signal.reason === "timeout")
      return { state: "failed", errorCode: "timeout" };
    // The scope watch aborts with this reason when the administrator right was withdrawn.
    if (signal.reason === "adminRevoked")
      return { state: "failed", errorCode: "adminRevoked" };
    return isStopRequested
      ? { state: "stopped", errorCode: null }
      : { state: "interrupted", errorCode: "interrupted" };
  }
  const detail = failureDetail(error, stage);
  const code = errorCodeOf(error);
  if (code !== null) return { state: "failed", errorCode: code, detail };
  logDiagnostic("PicaAcpJob", "error", "[pages] A Pica job failed.", error);
  return { state: "failed", errorCode: "general", detail };
}

/** Where a job failed and, for a refused tool or a failed step, which one and why. */
function failureDetail(
  error: unknown,
  stage: ChatJobFailureStage,
): ChatJobFailureDetail {
  if (error instanceof AgentToolReadinessError)
    return {
      stage,
      tool: error.tool,
      toolStatus: error.status,
      diagnostic: error.diagnostic,
    };
  if (error instanceof AgentStepFailedError)
    return {
      stage,
      step: error.step,
      ...(error.cause === null ? {} : { cause: error.cause }),
    };
  return { stage };
}

/** Logs the start of a job. */
export function logPicaJobStart(): void {
  logEvent({
    level: "info",
    event: "pica.job.started",
    component: "PicaAcpJob",
    message: "Pica job started",
  });
}

/**
 * Logs the end of a job; a failure names where it stopped and, for a refused
 * tool or a failed step, which one with its safe code.
 */
export function logPicaJobEnd(
  outcome: PicaAcpOutcome,
  metrics: DatabaseLogSummary,
): void {
  logEvent({
    level: outcome.state === "failed" ? "error" : "info",
    event: "pica.job.completed",
    component: "PicaAcpJob",
    message: "Pica job ended and cleanup attempted",
    metadata: {
      status: outcome.state,
      code: outcome.errorCode,
      ...(outcome.detail ?? {}),
      ...metrics,
    },
  });
}

/**
 * Sums the tokens of the turns of a job; a turn without a report makes the sum partial.
 * @param usage - Context and cost as the adapter reported them last.
 * @param turns - The tokens of every turn, `null` for a turn without a report.
 * @param isAlwaysPartial - The runner never reports every token of a turn.
 */
export function sumJobUsage(
  usage: Pick<ChatJobUsage, "context" | "cost">,
  turns: readonly (Omit<ChatTokenUsage, "isPartial"> | null)[],
  isAlwaysPartial: boolean,
): ChatJobUsage {
  const reported = turns.filter(
    (entry): entry is Omit<ChatTokenUsage, "isPartial"> => entry !== null,
  );
  const sum = (field: "input" | "output" | "total"): number =>
    reported.reduce((total, entry) => total + entry[field], 0);
  return {
    ...usage,
    tokens:
      reported.length === 0
        ? null
        : {
            input: sum("input"),
            output: sum("output"),
            total: sum("total"),
            isPartial: reported.length < turns.length || isAlwaysPartial,
          },
  };
}
