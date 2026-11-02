import { AgentError } from "@/backend/error/AgentErrors";
import { RUNNER_CONTINUATION_VERSION } from "@/definition/RunnerContinuation";

import type { RunnerExecution } from "@/definition/RunnerExecution";

/** What a dispatch asks of the runner about the native session of a writing job. */
export interface RemoteContinuationTerms {
  /** The live runner announced continuation support. */
  readonly isSupported: boolean;
  /** The native session a retry must continue; `null` opens a new one. */
  readonly resumeSessionId: string | null;
}

/**
 * Asks a runner that can prove its work to keep and report the session of a writing CLI job.
 *
 * @param command - The frozen command of the attempt.
 * @param terms - Whether the live runner supports continuation and which session a retry continues.
 * @returns The command with its continuation request; reading jobs and runners
 * without support keep the command as it is, and the retry decision then
 * names the missing evidence.
 * @throws {AgentError} `acp_session_resume_failed` when a retry must continue a
 * native session but the live runner cannot; no new conversation replaces it.
 */
export function remoteContinuationCommand(
  command: RunnerExecution,
  terms: RemoteContinuationTerms,
): RunnerExecution {
  const program = command.program;
  if (program.kind !== "cli" || program.access !== "yolo") return command;
  if (!terms.isSupported) {
    if (terms.resumeSessionId !== null)
      throw new AgentError("acp_session_resume_failed");
    return command;
  }
  return {
    ...command,
    continuation: {
      version: RUNNER_CONTINUATION_VERSION,
      ...(terms.resumeSessionId === null
        ? {}
        : { resumeSessionId: terms.resumeSessionId }),
    },
  };
}
