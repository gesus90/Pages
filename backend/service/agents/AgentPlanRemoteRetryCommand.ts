import { AgentError } from "@/backend/error/AgentErrors";
import { MAX_RUNNER_PROMPT_CHARACTERS } from "@/definition/RunnerExecution";

import type { RemoteRetryTerms } from "./AgentPlanRemoteDispatch";
import type { RunnerExecution } from "@/definition/RunnerExecution";

/** A retry is a new remote one-shot; it is labelled honestly and never claims a native continuation. */
export function remoteRetryCommand(
  command: RunnerExecution,
  retry: RemoteRetryTerms | undefined,
): RunnerExecution {
  if (!retry || command.program.kind === "script") return command;
  const notice = [
    "## Pages automatic session retry",
    "",
    `A technical session error ended attempt ${retry.attemptNumber - 1} of 3. This remote one-shot starts a new native session and does not remember the earlier conversation. Files and other external effects of the earlier attempt may already exist. Inspect the current state first, keep correct results, and do not repeat a completed external action.`,
    "",
    "",
  ].join("\n");
  const prompt = `${notice}${command.program.prompt}`;
  if (prompt.length > MAX_RUNNER_PROMPT_CHARACTERS)
    throw new AgentError("plan_invalid");
  return { ...command, program: { ...command.program, prompt } };
}
