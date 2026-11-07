import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { isProjectDeletionConfirmation } from "@/definition/AgentProjectDeletion";

import type { DatabaseTransaction } from "@/backend/database/Database";

/**
 * Returns the confirmation word of the account's current interface language.
 *
 * @param database - The connection or transaction to read the settings with.
 * @param userId - The account that confirms.
 * @returns `DELETE` for English, `LÖSCHEN` otherwise.
 */
export async function agentConfirmationWord(
  database: Pick<DatabaseTransaction, "query" | "execute">,
  userId: string,
): Promise<"DELETE" | "LÖSCHEN"> {
  const settings = await new UserSettingsRepository(database).findByUserId(
    userId,
  );
  return settings?.language === "en" ? "DELETE" : "LÖSCHEN";
}

/** Requires the exact confirmation word in the account's current interface language. */
export async function requireAgentConfirmation(
  database: DatabaseTransaction,
  userId: string,
  confirmation: unknown,
): Promise<void> {
  if (confirmation !== (await agentConfirmationWord(database, userId)))
    throw new AgentOperationError("CONFIRMATION_REQUIRED");
}

/**
 * Requires one of the two confirmation words of a project deletion.
 *
 * @param confirmation - What the caller passed as confirmation.
 * @throws {AgentOperationError} `CONFIRMATION_REQUIRED` for anything but exactly `LÖSCHEN` or `DELETE`.
 *
 * @remarks
 * Both words are valid whatever language the account uses, because the
 * deletion is too far-reaching to fail on a language setting. The check is
 * exact: neither case nor spaces are corrected.
 */
export function requireProjectDeletionConfirmation(
  confirmation: unknown,
): void {
  if (!isProjectDeletionConfirmation(confirmation))
    throw new AgentOperationError("CONFIRMATION_REQUIRED");
}
