import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { isProjectDeletionConfirmation } from "@/definition/AgentProjectDeletion";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** Requires the exact confirmation word in the account's current interface language. */
export async function requireAgentConfirmation(
  database: DatabaseTransaction,
  userId: string,
  confirmation: unknown,
): Promise<void> {
  const settings = await new UserSettingsRepository(database).findByUserId(
    userId,
  );
  const expected = settings?.language === "en" ? "DELETE" : "LÖSCHEN";
  if (confirmation !== expected)
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
