import { AgentJobAnswerError } from "@/backend/error/AgentJobAnswerError";

import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { User } from "@/definition/User";
import type { AgentEmployeeSessions } from "./AgentEmployeeSessions";

/** A started job of an agent whose answer is awaited. */
export interface AwaitedAgentJob {
  readonly agent: User;
  readonly sessionId: string;
  readonly jobId: string;
}

/** Where the job and its answer are read, and how long the wait lasts. */
export interface AgentJobWaiting {
  readonly sessions: Pick<AgentEmployeeSessions, "job">;
  readonly messages: Pick<ChatSessionRepository, "messages">;
  readonly pollMilliseconds: number;
  readonly timeoutMilliseconds: number;
  readonly now: () => Date;
  readonly wait?: (milliseconds: number) => Promise<void>;
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds).unref();
  });
}

/**
 * Waits for the end of an agent's job and reads its answer (PAGE-266, PAGE-276).
 *
 * @param job - The started job.
 * @param waiting - The reads and the limits of the wait.
 * @returns The last assistant message of the session; empty without one.
 * @throws {AgentJobAnswerError} With the terminal state and original `failureCode` when the job ends other than
 * completed or outlasts the timeout.
 */
export async function awaitAgentJobAnswer(
  job: AwaitedAgentJob,
  waiting: AgentJobWaiting,
): Promise<string> {
  const deadline = waiting.now().getTime() + waiting.timeoutMilliseconds;
  for (;;) {
    const current = await waiting.sessions.job(
      job.agent,
      job.sessionId,
      job.jobId,
    );
    if (current && current.state !== "running") {
      if (current.state !== "completed")
        throw new AgentJobAnswerError(current.state, current.errorCode);
      break;
    }
    if (waiting.now().getTime() > deadline)
      throw new AgentJobAnswerError("failed", "timeout");
    await (waiting.wait ?? defaultWait)(waiting.pollMilliseconds);
  }
  const messages = await waiting.messages.messages(job.sessionId);
  const answer = messages.at(-1);
  return answer?.role === "assistant" ? answer.content : "";
}
