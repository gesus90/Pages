import { AgentError } from "@/backend/error/AgentErrors";
import { MAX_RUNNER_PROMPT_CHARACTERS } from "@/definition/RunnerExecution";

import type { RemoteRetryTerms } from "./AgentPlanRemoteDispatch";
import type { RunnerExecution } from "@/definition/RunnerExecution";

/**
 * A retry names what it really is: the same native session, or a new remote one-shot.
 *
 * @remarks
 * Only a runner that resumed the recorded session may claim to continue the
 * conversation. Otherwise the notice says the earlier conversation is gone.
 */
export function remoteRetryCommand(
  command: RunnerExecution,
  retry: RemoteRetryTerms | undefined,
): RunnerExecution {
  if (!retry || command.program.kind === "script") return command;
  const mode =
    retry.resumeSessionId === null
      ? "This remote one-shot starts a new native session and does not remember the earlier conversation."
      : "This remote one-shot continues the earlier native session.";
  const notice = [
    "## Pages automatic session retry",
    "",
    `A technical session error ended attempt ${retry.attemptNumber - 1} of 3. ${mode} Files and other external effects of the earlier attempt may already exist. Inspect the current state first, keep correct results, and do not repeat a completed external action.`,
    "",
    "",
  ].join("\n");
  const prompt = `${notice}${command.program.prompt}`;
  if (prompt.length > MAX_RUNNER_PROMPT_CHARACTERS)
    throw new AgentError("plan_invalid");
  return { ...command, program: { ...command.program, prompt } };
}
