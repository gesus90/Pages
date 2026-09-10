import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/database/Database", () => ({
  Database: {
    create: vi.fn(),
  },
}));

vi.mock("@/backend/database/DatabasePath", () => ({
  resolveDatabasePath: vi.fn(() => "/mocked/pages.db"),
}));

vi.mock("@/backend/database/repositories/SessionRepository", () => ({
  SessionRepository: vi.fn(),
}));

vi.mock("@/backend/database/repositories/UserRepository", () => ({
  UserRepository: vi.fn(),
}));

vi.mock("@/backend/auth/PasswordHasher", () => ({
  PasswordHasher: vi.fn(),
}));

vi.mock("@/backend/service/UserService", () => ({
  UserService: vi.fn(),
}));

vi.mock("@/backend/auth/SessionService", () => ({
  SessionService: vi.fn(),
}));

vi.mock("@/backend/auth/AuthService", () => ({
  AuthService: vi.fn(),
}));

vi.mock("@/backend/setup/SetupService", () => ({
  SetupService: vi.fn(),
}));

vi.mock("@/backend/github/GitHubTokenKey", () => ({
  resolveGitHubTokenKey: vi.fn(() => Buffer.alloc(32)),
}));

import { AuthService } from "@/backend/auth/AuthService";
import { SessionService } from "@/backend/auth/SessionService";
import { Database } from "@/backend/database/Database";
import { SetupService } from "@/backend/setup/SetupService";
import { getApplicationServices } from "@/app/lib/services.server";

const mockedDatabaseCreate = vi.mocked(Database.create);
const mockedSetup = vi.mocked(SetupService);
const mockedSession = vi.mocked(SessionService);
const mockedAuth = vi.mocked(AuthService);

function createDatabase(): {
  close: ReturnType<typeof vi.fn>;
  migrate: ReturnType<typeof vi.fn>;
} {
  return {
    close: vi.fn(),
    migrate: vi.fn().mockResolvedValue(undefined),
  };
}

function stubSetup(
  ensures: boolean,
  migrates = false,
): {
  ensureDefaultAdministrator: ReturnType<typeof vi.fn>;
  migrateLegacyBootstrapAdministrator: ReturnType<typeof vi.fn>;
} {
  const ensureDefaultAdministrator = vi.fn().mockResolvedValue(ensures);
  const migrateLegacyBootstrapAdministrator = vi
    .fn()
    .mockResolvedValue(migrates);
  mockedSetup.mockImplementation(function (this: unknown) {
    return {
      ensureDefaultAdministrator,
      migrateLegacyBootstrapAdministrator,
    } as unknown as InstanceType<typeof mockedSetup>;
  });

  return { ensureDefaultAdministrator, migrateLegacyBootstrapAdministrator };
}

function stubSessionCleanup(): ReturnType<typeof vi.fn> {
  const removeExpiredSessions = vi.fn().mockResolvedValue(undefined);
  mockedSession.mockImplementation(function (this: unknown) {
    return { removeExpiredSessions } as unknown as InstanceType<
      typeof mockedSession
    >;
  });

  return removeExpiredSessions;
}

function resetServiceGlobals(): void {
  delete globalThis.pagesServices;
  delete globalThis.pagesShutdownHandlerRegistered;
  delete globalThis.pagesSyncSchedulerStarted;
}

describe("getApplicationServices", () => {
  beforeEach(() => {
    resetServiceGlobals();
    vi.clearAllMocks();
    mockedDatabaseCreate.mockResolvedValue(
      createDatabase() as unknown as Awaited<
        ReturnType<typeof mockedDatabaseCreate>
      >,
    );
    stubSetup(false);
    stubSessionCleanup();
  });

  it("initializes services and reports a created administrator", async () => {
    const { ensureDefaultAdministrator } = stubSetup(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const services = await getApplicationServices();

    expect(mockedDatabaseCreate).toHaveBeenCalledWith("/mocked/pages.db");
    expect(ensureDefaultAdministrator).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Created the default administrator "admin"'),
    );
    expect(services.authService).toBeDefined();
    expect(services.sessionService).toBeDefined();
    expect(mockedAuth).toHaveBeenCalledTimes(1);

    log.mockRestore();
    resetServiceGlobals();
  });

  it("reports a migrated legacy administrator", async () => {
    stubSetup(false, true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await getApplicationServices();

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Migrated the default administrator"),
    );

    log.mockRestore();
    resetServiceGlobals();
  });

  it("skips the creation message when the administrator exists", async () => {
    stubSetup(false);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await getApplicationServices();

    expect(log).not.toHaveBeenCalledWith(
      expect.stringContaining("Created the default administrator"),
    );

    log.mockRestore();
    resetServiceGlobals();
  });

  it("reuses the initialized services for later callers", async () => {
    stubSetup(false);

    const first = await getApplicationServices();
    const second = await getApplicationServices();

    expect(second).toBe(first);
    expect(mockedDatabaseCreate).toHaveBeenCalledTimes(1);
    expect(first.gitHubSyncService).toBeDefined();

    resetServiceGlobals();
  });

  it("starts the sync scheduler only once per process", async () => {
    stubSetup(false);

    await getApplicationServices();

    expect(globalThis.pagesSyncSchedulerStarted).toBe(true);

    delete globalThis.pagesServices;
    await getApplicationServices();

    expect(mockedDatabaseCreate).toHaveBeenCalledTimes(2);

    resetServiceGlobals();
  });

  it("removes expired sessions during initialization", async () => {
    stubSetup(false);
    const removeExpiredSessions = stubSessionCleanup();

    await getApplicationServices();

    expect(removeExpiredSessions).toHaveBeenCalledTimes(1);

    resetServiceGlobals();
  });

  it("propagates database initialization failures", async () => {
    mockedDatabaseCreate.mockRejectedValue(new Error("Disk unavailable"));

    await expect(getApplicationServices()).rejects.toThrow("Disk unavailable");

    resetServiceGlobals();
  });

  it("registers the shutdown handler only once", async () => {
    const handlers = new Map<string, () => void>();
    const once = vi.spyOn(process, "once").mockImplementation(((
      event: string,
      handler: () => void,
    ) => {
      handlers.set(event, handler);

      return process;
    }) as typeof process.once);

    stubSetup(false);
    await getApplicationServices();

    expect(handlers.has("SIGINT")).toBe(true);
    expect(handlers.has("SIGTERM")).toBe(true);

    delete globalThis.pagesServices;
    await getApplicationServices();

    expect(once).toHaveBeenCalledTimes(2);

    once.mockRestore();
    resetServiceGlobals();
  });

  it("closes the database and exits on shutdown signals", async () => {
    const handlers = new Map<string, () => void>();
    const once = vi.spyOn(process, "once").mockImplementation(((
      event: string,
      handler: () => void,
    ) => {
      handlers.set(event, handler);

      return process;
    }) as typeof process.once);
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    const database = createDatabase();
    mockedDatabaseCreate.mockResolvedValue(
      database as unknown as Awaited<ReturnType<typeof mockedDatabaseCreate>>,
    );
    stubSetup(false);

    await getApplicationServices();

    handlers.get("SIGTERM")?.();

    expect(database.close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);

    once.mockRestore();
    exit.mockRestore();
    resetServiceGlobals();
  });
});
