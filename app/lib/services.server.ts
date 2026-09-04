import path from "node:path";

import { AuthService } from "@/backend/auth/AuthService";
import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { SessionService } from "@/backend/auth/SessionService";
import { Database } from "@/backend/database/Database";
import { resolveDatabasePath } from "@/backend/database/DatabasePath";
import { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { UserService } from "@/backend/service/UserService";
import { SetupService } from "@/backend/setup/SetupService";

/** Server-only service instances shared by React Router loaders and actions. */
export interface ApplicationServices {
  readonly authService: AuthService;
  readonly sessionService: SessionService;
}

declare global {
  var pagesServices: Promise<ApplicationServices> | undefined;
}

async function initializeServices(): Promise<ApplicationServices> {
  const databasePath = resolveDatabasePath();
  const database = await Database.create(databasePath);
  const migrationsPath = path.join(
    process.cwd(),
    "backend",
    "database",
    "migrations",
  );

  await database.migrate(migrationsPath);

  const passwordHasher = new PasswordHasher();
  const userRepository = new UserRepository(database);
  const sessionRepository = new SessionRepository(database);
  const userService = new UserService(userRepository);
  const sessionService = new SessionService(sessionRepository, userService);
  const setupService = new SetupService(userRepository, passwordHasher);

  if (await setupService.ensureDefaultAdministrator()) {
    console.log(
      '[pages] Created the default administrator "admin". Change its password after the first login.',
    );
  }

  await sessionService.removeExpiredSessions();

  return {
    authService: new AuthService(userService, sessionService, passwordHasher),
    sessionService,
  };
}

/** Returns the initialized server-side services for the current Pages process. */
export function getApplicationServices(): Promise<ApplicationServices> {
  globalThis.pagesServices ??= initializeServices();

  return globalThis.pagesServices;
}
