import type { AgentMessageQueue } from "@/definition/AgentSessionLimits";
import type { VirtualChatMessage } from "@/definition/VirtualChat";
import type { QueuedAgentMessage } from "./AgentEmployeeSessions";

/**
 * Marks the messages of a history whose answer waits (PAGE-304).
 *
 * @param messages - The history, oldest first.
 * @param queued - Why a message waits, by its ID.
 * @returns The history with `queue` on every waiting message.
 */
export function markQueuedMessages(
  messages: readonly VirtualChatMessage[],
  queued: ReadonlyMap<string, AgentMessageQueue>,
): VirtualChatMessage[] {
  return messages.map((message) => {
    const queue = queued.get(message.id);
    return queue ? { ...message, queue } : message;
  });
}

/**
 * The messages of a direct chat with an agent that wait for their turn of the
 * running job: joined it, and not yet followed by an answer.
 *
 * @param messages - The history, oldest first.
 * @param waitingIds - The messages the running job holds back.
 * @returns `chat` by message ID.
 */
export function waitingInChat(
  messages: readonly VirtualChatMessage[],
  waitingIds: ReadonlySet<string>,
): Map<string, AgentMessageQueue> {
  const lastAnswer = messages.findLastIndex(
    (message) => message.authorId !== null,
  );
  return new Map(
    messages
      .slice(lastAnswer + 1)
      .filter((message) => waitingIds.has(message.id))
      .map((message) => [message.id, "chat"] as const),
  );
}

/**
 * The messages of a person that wait for a free place, as the history shows
 * them after the stored ones; they are stored once their answer begins.
 */
export function queuedChatMessages(
  queued: readonly QueuedAgentMessage[],
): VirtualChatMessage[] {
  return queued.map((message) => ({
    id: `queued-${message.id}`,
    authorId: null,
    content: message.text,
    toolUses: [],
    queue: "limit",
  }));
}
