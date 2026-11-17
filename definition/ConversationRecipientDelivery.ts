/**
 * How a message of a person reaches each agent of a group, apart from who
 * was chosen to answer it.
 * @remarks
 * Routing chooses the recipients; the intent says per recipient how the
 * message should reach that agent, and the delivery records what the server
 * confirmed. One stored message can reach one agent inside its running answer
 * and start a new task for another. A confirmed new task names its
 * acceptance, never the start of a process: the usual limits of concurrent
 * sessions still apply.
 */

/**
 * How a message should reach one recipient: `task` as a new task, waiting
 * behind the agent's running answer; `steer` into the running answer, or as a
 * new task when the agent is free; `after` behind the running answer, as the
 * person chose with "nach der Antwort".
 */
export type ConversationDeliveryIntent = "task" | "steer" | "after";

/**
 * What the server confirmed for one recipient: `injected` when the running
 * answer took the message, `started` when a new task was accepted, `queued`
 * when it waits for the agent's running answer or a free place, `failed` when
 * neither the running answer nor a new task took it.
 */
export type ConversationDeliveryState =
  "injected" | "started" | "queued" | "failed";

/** The confirmed delivery of one message to one agent. */
export interface ConversationRecipientDelivery {
  readonly agentId: string;
  readonly intent: ConversationDeliveryIntent;
  readonly state: ConversationDeliveryState;
}

/** Every intent, for reading stored values. */
export const CONVERSATION_DELIVERY_INTENTS: readonly ConversationDeliveryIntent[] =
  ["task", "steer", "after"];

/** Every confirmed state, for reading stored values. */
export const CONVERSATION_DELIVERY_STATES: readonly ConversationDeliveryState[] =
  ["injected", "started", "queued", "failed"];
