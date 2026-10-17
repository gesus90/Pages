import { AgentError } from "@/backend/error/AgentErrors";
import { ChatError } from "@/backend/error/ChatErrors";
import { PicaAcpJobError } from "@/backend/error/PicaAcpJobError";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { redactAssistantCredentials } from "@/backend/service/assistant/TextAssistantValidation";
import { CHAT_LIMITS } from "@/definition/Chat";

import type { PlanSessionTurn } from "@/backend/agents/AgentPlanExecution";
import type { ChatJobState } from "@/definition/ChatJob";

/** The terminal state and safe code produced by one Pica job. */
export interface PicaAcpOutcome {
  readonly state: Exclude<ChatJobState, "running">;
  readonly errorCode: string | null;
}

/**
 * Requires a turn the runner completed.
 *
 * @throws {PicaAcpJobError} With the code of the runner, `bridgeUnavailable`,
 * `timeout` or `providerFailed`.
 */
export function requireCompleted(result: PlanSessionTurn): void {
  if (result.errorCode !== null)
    throw new PicaAcpJobError(
      result.errorCode === "plan_mcp_unavailable"
        ? "bridgeUnavailable"
        : result.errorCode,
    );
  if (result.failure === null) return;
  throw new PicaAcpJobError(
    result.failure === "timeout" ? "timeout" : "providerFailed",
  );
}

/**
 * Reads the answer of a turn as the conversation stores it.
 *
 * @throws {PicaAcpJobError} `invalidOutput` for an empty or too long answer.
 */
export function readAnswer(output: string): string {
  const answer = redactAssistantCredentials(output.trim());
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
    error instanceof TextAssistantError
  )
    return error.code;
  return null;
}
