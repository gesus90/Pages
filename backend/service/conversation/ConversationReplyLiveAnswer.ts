import { logCaughtError } from "@/backend/logging/Logger";

import type { LiveAnswerSink } from "./ConversationLiveAnswer";
import type {
  ConversationReplyJob,
  ConversationReplyRunnerDependencies,
} from "./ConversationReplyTypes";

const COMPONENT = "ConversationAgentReplies";

/**
 * Opens the live answer of a job for the members: every member sees its text
 * and tools, its thoughts only the person of a direct conversation or the
 * creator of a group. Every part names the run of the job, as the reading of
 * the chat page does for the agent that answers.
 * @param dependencies - The stream of live answers; absent opens none.
 * @param job - The answer that begins.
 * @param jobId - This run of the job.
 * @returns The open live answer, or `undefined` without a stream.
 */
export async function openReplyLiveAnswer(
  dependencies: Pick<ConversationReplyRunnerDependencies, "answerStream">,
  job: ConversationReplyJob,
  jobId: string,
): Promise<LiveAnswerSink | undefined> {
  const stream = dependencies.answerStream;
  if (!stream) return undefined;
  const { conversation, memberIds } = job.round;
  const recipientIds = memberIds.filter((id) => id !== job.agentId);
  let thoughtRecipientIds = recipientIds;
  if (conversation.kind === "group") {
    const owner = await stream
      .ownerOf(conversation.id)
      .catch((error: unknown) => {
        // Without a known owner nobody reads the thoughts.
        logCaughtError(COMPONENT, error);
        return null;
      });
    thoughtRecipientIds =
      owner !== null && recipientIds.includes(owner) ? [owner] : [];
  }
  return stream.open({
    agentId: job.agentId,
    chatKind: "conversation",
    chatId: conversation.id,
    recipientIds,
    thoughtRecipientIds,
    isTurnStored: false,
    job: { roundId: job.round.originMessageId, jobId },
  });
}
