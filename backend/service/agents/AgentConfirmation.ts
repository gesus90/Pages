import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

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
