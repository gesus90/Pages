import { readTextColumn } from "@/backend/database/RowValue";
import { createInClause } from "@/backend/database/repositories/task/InClause";
import {
  CONVERSATION_DELIVERY_INTENTS,
  CONVERSATION_DELIVERY_STATES,
} from "@/definition/ConversationRecipientDelivery";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  ConversationDeliveryState,
  ConversationRecipientDelivery,
} from "@/definition/ConversationRecipientDelivery";

/** The claimed answer of one agent to one message. */
export interface ConversationDeliveryTarget {
  readonly originMessageId: string;
  readonly agentId: string;
  readonly triggerMessageId: string;
}

type DeliveryDatabase = Pick<Database, "query" | "execute">;

function readDelivery(
  row: readonly DatabaseValue[],
): (ConversationRecipientDelivery & { readonly messageId: string }) | null {
  const intentText = readTextColumn(row, 2, "delivery_intent");
  const stateText = readTextColumn(row, 3, "delivery");
  const intent = CONVERSATION_DELIVERY_INTENTS.find(
    (entry) => entry === intentText,
  );
  const state = CONVERSATION_DELIVERY_STATES.find(
    (entry) => entry === stateText,
  );
  if (!intent || !state) return null;
  return {
    messageId: readTextColumn(row, 0, "trigger_message_id"),
    agentId: readTextColumn(row, 1, "agent_id"),
    intent,
    state,
  };
}

/**
 * The confirmed delivery of messages of people to each asked agent.
 * @remarks
 * The delivery lives on the claimed answer, whose key
 * `(trigger_message_id, agent_id)` already holds every agent to one answer
 * per message, so a repeated event, a repeated send or a restart never adds
 * a second delivery.
 */
export class ConversationDeliveryRepository {
  private readonly database: DeliveryDatabase;

  public constructor(database: DeliveryDatabase) {
    this.database = database;
  }

  /** Records what the server confirmed for the claimed answer of one agent. */
  public async record(
    target: ConversationDeliveryTarget,
    change: {
      readonly state: ConversationDeliveryState;
      readonly updatedAt: string;
    },
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE conversation_reply_targets
        SET
            delivery = $delivery,
            updated_at = $updated_at
        WHERE origin_message_id = $origin_message_id
            AND agent_id = $agent_id
            AND trigger_message_id = $trigger_message_id
            AND delivery_intent IS NOT NULL;
      `,
      {
        origin_message_id: target.originMessageId,
        agent_id: target.agentId,
        trigger_message_id: target.triggerMessageId,
        delivery: change.state,
        updated_at: change.updatedAt,
      },
    );
  }

  /**
   * Reads the confirmed deliveries of messages.
   * @param messageIds - Messages of people.
   * @returns The deliveries by message ID, in the order the agents were
   * asked; a message without a confirmed delivery has none.
   */
  public async forMessages(
    messageIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly ConversationRecipientDelivery[]>> {
    const deliveries = new Map<string, ConversationRecipientDelivery[]>();
    if (messageIds.length === 0) return deliveries;
    const ids = createInClause("message", messageIds);
    const rows = await this.database.query(
      `
        SELECT
            trigger_message_id,
            agent_id,
            delivery_intent,
            delivery
        FROM conversation_reply_targets
        WHERE trigger_message_id IN (${ids.placeholders})
            AND delivery_intent IS NOT NULL
            AND delivery IS NOT NULL
        ORDER BY created_at ASC, agent_id ASC;
      `,
      ids.parameters,
    );
    for (const row of rows) {
      const delivery = readDelivery(row);
      if (!delivery) continue;
      const { messageId, ...entry } = delivery;
      deliveries.set(messageId, [...(deliveries.get(messageId) ?? []), entry]);
    }
    return deliveries;
  }
}
