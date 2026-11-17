import type { ConversationDelivery } from "@/definition/ConversationLiveAnswer";
import type { ConversationDeliveryIntent } from "@/definition/ConversationRecipientDelivery";

/**
 * How a message of a person in a group reaches an agent it names with @.
 * @param delivery - How the person sent it; absent for an ordinary send.
 * @returns `after` when the person chose to send after the answer; otherwise
 * `steer`, which goes into the agent's running answer, or starts a new task
 * when the agent is free.
 */
export function mentionDelivery(
  delivery: ConversationDelivery | undefined,
): ConversationDeliveryIntent {
  return delivery === "after" ? "after" : "steer";
}

/**
 * How a message of a person in a group without an @ reaches an agent the
 * decision model chose.
 * @param delivery - How the person sent it; absent for an ordinary send.
 * @returns The way the person chose deliberately; otherwise `task`, because
 * being chosen is no permission to go into a running answer.
 */
export function chosenDelivery(
  delivery: ConversationDelivery | undefined,
): ConversationDeliveryIntent {
  return delivery ?? "task";
}
