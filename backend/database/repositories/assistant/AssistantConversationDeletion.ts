import type {
  DatabaseTransaction,
  SqlParameters,
} from "@/backend/database/Database";

/** Removes message rows and conversations in the caller's deletion transaction. */
export async function deleteAssistantConversations(
  database: DatabaseTransaction,
  selection: { readonly condition: string; readonly parameters: SqlParameters },
): Promise<void> {
  await database.execute(
    `
    DELETE FROM assistant_messages
    WHERE conversation_id IN (
        SELECT id
        FROM assistant_conversations
        WHERE ${selection.condition}
    );
  `,
    selection.parameters,
  );
  await database.execute(
    `
    DELETE FROM assistant_conversations
    WHERE ${selection.condition};
  `,
    selection.parameters,
  );
}
