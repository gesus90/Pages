import { AgentError } from "@/backend/error/AgentErrors";
import { MAX_RUNNER_PROMPT_CHARACTERS } from "@/definition/RunnerExecution";

import { planRetryNotice } from "./AgentPlanRetryNotice";

import type { RemoteRetryTerms } from "./AgentPlanRemoteDispatch";
import type { RunnerExecution } from "@/definition/RunnerExecution";

/**
 * A retry names what it really is: the same native session, or a new remote one-shot.
 *
 * @remarks
 * Only a runner that resumed the recorded session may claim to continue the
 * conversation. Otherwise the notice says the earlier conversation is gone. A
 * form or functional failure also tells the agent what to repair.
 */
export function remoteRetryCommand(
  command: RunnerExecution,
  retry: RemoteRetryTerms | undefined,
): RunnerExecution {
  if (!retry || command.program.kind === "script") return command;
  const notice = retry.retry
    ? planRetryNotice(retry.retry, retry.resumeSessionId !== null)
    : "";
  const prompt = `${notice}${command.program.prompt}`;
  if (prompt.length > MAX_RUNNER_PROMPT_CHARACTERS)
    throw new AgentError("plan_invalid");
  return { ...command, program: { ...command.program, prompt } };
}
