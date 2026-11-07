import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import type { PicaAcpJobDependencies } from "./PicaAcpJobDependencies";
import type { PicaAcpJobSpecification } from "./PicaAcpJob";

/**
 * Runs one step of a job's closeout.
 *
 * @param task - The step.
 *
 * @remarks
 * A failure is logged without content and does not skip the other steps.
 */
export async function attemptPicaCloseoutStep(
  task: () => Promise<void>,
): Promise<void> {
  try {
    await task();
  } catch (error: unknown) {
    logCaughtError("PicaAcpJob", error);

    logDiagnostic(
      "PicaAcpJob",
      "error",
      "[pages] A Pica job closeout step failed.",
      error,
    );
  }
}

/**
 * Stores the agent session of a job through the conversation's last message,
 * so the next job continues it.
 *
 * @param dependencies - The repositories of the job.
 * @param specification - The job.
 * @param acpSessionId - The agent session the adapter identified; `null` stores nothing.
 */
export async function savePicaAcpSession(
  dependencies: Pick<PicaAcpJobDependencies, "messages" | "acpSessions">,
  specification: PicaAcpJobSpecification,
  acpSessionId: string | null,
): Promise<void> {
  if (acpSessionId === null) return;
  const { agent, sessionId, actor } = specification;
  const messages = await dependencies.messages.messages(sessionId);
  await dependencies.acpSessions.save({
    chatSessionId: sessionId,
    userId: actor.id,
    connectionId: agent.connection.id,
    model: agent.model,
    reasoningEffort: agent.reasoningEffort,
    profile: specification.run.runner.profile,
    acpSessionId,
    throughMessageId: messages.at(-1)?.id ?? null,
  });
}
