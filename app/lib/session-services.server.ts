import { isPagesRunsProcess } from "@/backend/runtime/RunsMode";
import { isLocalSessionOwner } from "@/backend/agents/local/LocalSessionMode";
import { logDiagnostic } from "@/backend/logging/Logger";
import { AuthService } from "@/backend/auth/AuthService";
import { LoginThrottle } from "@/backend/auth/LoginThrottle";
import { SessionService } from "@/backend/auth/SessionService";
import { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import { SetupService } from "@/backend/setup/SetupService";

import type { Database } from "@/backend/database/Database";
import type { PasswordHasher } from "@/backend/auth/PasswordHasher";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { UserService } from "@/backend/service/UserService";

/** Builds authentication around the initialized application sessions. */
export async function createApplicationAuthentication(
  database: Database,
  foundation: {
    readonly userRepository: UserRepository;
    readonly userService: UserService;
    readonly passwordHasher: PasswordHasher;
  },
): Promise<{ sessionService: SessionService; authService: AuthService }> {
  const { userRepository, userService, passwordHasher } = foundation;
  const sessionService = await prepareSessions(
    new SetupService(userRepository, passwordHasher),
    new SessionService(new SessionRepository(database), userService),
  );
  return {
    sessionService,
    authService: new AuthService(
      userService,
      sessionService,
      passwordHasher,
      new LoginThrottle(),
    ),
  };
}

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
