import { isPagesRunsProcess } from "@/backend/runtime/RunsMode";
import { isLocalSessionOwner } from "@/backend/agents/local/LocalSessionMode";
import { logDiagnostic } from "@/backend/logging/Logger";

import type { SetupService } from "@/backend/setup/SetupService";
import type { SessionService } from "@/backend/auth/SessionService";

/**
 * Brings accounts and sessions up to date at startup.
 *
 * @param setupService - Upgrades a legacy bootstrap administrator.
 * @param sessionService - Removes the sessions that expired meanwhile.
 * @returns The session service, ready for requests.
 */
export async function prepareSessions(
  setupService: SetupService,
  sessionService: SessionService,
): Promise<SessionService> {
  if (isLocalSessionOwner() || isPagesRunsProcess()) return sessionService;
  if (await setupService.migrateLegacyBootstrapAdministrator()) {
    logDiagnostic(
      "services",
      "info",
      '[pages] Migrated the default administrator "admin" to the current password hashing algorithm.',
    );
  }

  await sessionService.removeExpiredSessions();

  return sessionService;
}
