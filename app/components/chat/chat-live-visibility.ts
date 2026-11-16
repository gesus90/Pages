import { isChatJobRunning } from "./chat-job-state";

import type { ChatMessage } from "@/definition/Chat";
import type { ChatLiveJob } from "./chat-job-state";
import type { ChatSending } from "./use-chat-send";

interface ChatLiveVisibilityOptions {
  readonly messages: readonly ChatMessage[];
  readonly live: ChatLiveJob | null;
  readonly sending: ChatSending | null;
}

function hasAnswerAfter(
  messages: readonly ChatMessage[],
  messageId: string | undefined,
  afterMessageId?: string,
): boolean {
  const question = messages.findIndex(
    (message) => message.id === messageId && message.role === "user",
  );
  if (question < 0) return false;
  const after = messages.findIndex(({ id }) => id === afterMessageId);
  return messages
    .slice(Math.max(question, after) + 1)
    .some(({ role }) => role === "assistant");
}

function sendingMessageId(
  messages: readonly ChatMessage[],
  sending: ChatSending,
): string | undefined {
  if (sending.messageId !== undefined) return sending.messageId;
  const before = messages.findIndex(({ id }) => id === sending.afterMessageId);
  if (sending.afterMessageId !== null && before < 0) return undefined;
  return messages.slice(before + 1).find(({ role }) => role === "user")?.id;
}

/**
 * The shared visibility rule for job and direct-request activity rows.
 * Message positions associate answers with requests; clocks only measure elapsed time.
 */
export function shouldShowChatLiveStatus({
  messages,
  live,
  sending,
}: ChatLiveVisibilityOptions): boolean {
  if (live !== null && isChatJobRunning(live))
    return !hasAnswerAfter(
      messages,
      live.turnMessageId ?? live.job.messageId,
      live.turnAfterMessageId,
    );
  if (sending === null) return false;
  const messageId = sendingMessageId(messages, sending);
  const hasJobEnded =
    messageId !== undefined &&
    live !== null &&
    (messageId === live.turnMessageId || messageId === live.job.messageId);
  return !hasJobEnded && !hasAnswerAfter(messages, messageId);
}
