import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/database/Database", () => ({
  Database: {
    create: vi.fn(),
  },
}));

vi.mock("@/backend/runtime/PagesRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/backend/runtime/PagesRuntime")>()),
  getPagesRuntime: vi.fn(),
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

import { AdministrationService } from "@/backend/service/AdministrationService";
import { createAccess } from "../helpers/authorization";
import { createUser } from "../helpers/factories";
import { PERMISSION } from "@/definition/Role";
import { AuthService } from "@/backend/auth/AuthService";
import { SessionService } from "@/backend/auth/SessionService";
import { Database } from "@/backend/database/Database";
import { resolveGitHubTokenKey } from "@/backend/github/GitHubTokenKey";
import {
  getPagesRuntime,
  SetupPendingError,
} from "@/backend/runtime/PagesRuntime";
import { SetupService } from "@/backend/setup/SetupService";
import {
  activateApplicationServices,
  getApplicationServices,
} from "@/app/lib/services.server";

import type { PagesRuntime } from "@/backend/runtime/PagesRuntime";

const mockedDatabaseCreate = vi.mocked(Database.create);
const mockedSetup = vi.mocked(SetupService);
const mockedSession = vi.mocked(SessionService);
const mockedAuth = vi.mocked(AuthService);

function createDatabase(): {
  close: ReturnType<typeof vi.fn>;
  migrate: ReturnType<typeof vi.fn>;
} {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    migrate: vi.fn().mockResolvedValue(undefined),
  };
}

function stubSetup(migrates = false): ReturnType<typeof vi.fn> {
  const migrateLegacyBootstrapAdministrator = vi
    .fn()
    .mockResolvedValue(migrates);
  mockedSetup.mockImplementation(function (this: unknown) {
    return {
      migrateLegacyBootstrapAdministrator,
    } as unknown as InstanceType<typeof mockedSetup>;
  });

  return migrateLegacyBootstrapAdministrator;
}

function stubRuntime(getDatabasePath: () => string): void {
  vi.mocked(getPagesRuntime).mockResolvedValue({
    getDatabasePath,
  } as unknown as PagesRuntime);
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
    stubSetup();
    stubSessionCleanup();
    stubRuntime(() => "/mocked/pages.duckdb");
    vi.mocked(resolveGitHubTokenKey).mockReturnValue(Buffer.alloc(32));
  });

  it("opens the configured database and builds the services", async () => {
    const services = await getApplicationServices();

    expect(mockedDatabaseCreate).toHaveBeenCalledWith("/mocked/pages.duckdb");
    expect(resolveGitHubTokenKey).toHaveBeenCalledWith("/mocked/pages.duckdb");
    expect(services.authService).toBeDefined();
    expect(services.sessionService).toBeDefined();
    expect(mockedAuth).toHaveBeenCalledTimes(1);
    vi.spyOn(AdministrationService.prototype, "getContext").mockResolvedValue(
      createAccess(),
    );
    expect(
      await services.permissionService.allows(
        createUser(),
        PERMISSION.MANAGE_APPLICATION,
      ),
    ).toBe(false);

    resetServiceGlobals();
  });

  it("opens no database while the setup is pending and retries later", async () => {
    stubRuntime(() => {
      throw new SetupPendingError();
    });

    await expect(getApplicationServices()).rejects.toThrow(SetupPendingError);
    expect(mockedDatabaseCreate).not.toHaveBeenCalled();
    expect(globalThis.pagesServices).toBeUndefined();

    stubRuntime(() => "/mocked/pages.duckdb");

    await expect(getApplicationServices()).resolves.toBeDefined();
    resetServiceGlobals();
  });

  it("starts the services on the database a finished setup prepared", async () => {
    const database = createDatabase();
    const services = await activateApplicationServices(
      database as unknown as Database,
      "/setup/pages.duckdb",
    );

    expect(mockedDatabaseCreate).not.toHaveBeenCalled();
    expect(database.migrate).toHaveBeenCalledTimes(1);
    expect(resolveGitHubTokenKey).toHaveBeenCalledWith("/setup/pages.duckdb");
    await expect(getApplicationServices()).resolves.toBe(services);

    resetServiceGlobals();
  });

  it("reports a migrated legacy administrator", async () => {
    stubSetup(true);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await getApplicationServices();

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("Migrated the default administrator"),
    );

    info.mockRestore();
    resetServiceGlobals();
  });

  it("stays quiet when no legacy administrator needed a migration", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await getApplicationServices();

    expect(info).not.toHaveBeenCalled();

    info.mockRestore();
    resetServiceGlobals();
  });

  it("reuses the initialized services for later callers", async () => {
    const first = await getApplicationServices();
    const second = await getApplicationServices();

    expect(second).toBe(first);
    expect(mockedDatabaseCreate).toHaveBeenCalledTimes(1);
    expect(first.gitHubSyncService).toBeDefined();

    resetServiceGlobals();
  });

  it("starts the sync scheduler only once per process", async () => {
    await getApplicationServices();

    expect(globalThis.pagesSyncSchedulerStarted).toBe(true);

    delete globalThis.pagesServices;
    await getApplicationServices();

    expect(mockedDatabaseCreate).toHaveBeenCalledTimes(2);

    resetServiceGlobals();
  });

  it("removes expired sessions during initialization", async () => {
    const removeExpiredSessions = stubSessionCleanup();

    await getApplicationServices();

    expect(removeExpiredSessions).toHaveBeenCalledTimes(1);

    resetServiceGlobals();
  });

  it("propagates database initialization failures", async () => {
    mockedDatabaseCreate.mockRejectedValue(new Error("Disk unavailable"));

    await expect(getApplicationServices()).rejects.toThrow("Disk unavailable");
    expect(globalThis.pagesServices).toBeUndefined();

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

    await getApplicationServices();

    handlers.get("SIGTERM")?.();

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(0);
    });
    expect(database.close).toHaveBeenCalledTimes(1);

    once.mockRestore();
    exit.mockRestore();
    resetServiceGlobals();
  });

  it("exits with an error code when closing the database fails", async () => {
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
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    const database = createDatabase();
    database.close.mockRejectedValue(new Error("Disk full"));
    mockedDatabaseCreate.mockResolvedValue(
      database as unknown as Awaited<ReturnType<typeof mockedDatabaseCreate>>,
    );

    await getApplicationServices();

    handlers.get("SIGINT")?.();

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(1);
    });
    expect(exit).not.toHaveBeenCalledWith(0);
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("Closing the database failed"),
      expect.any(Error),
    );

    once.mockRestore();
    exit.mockRestore();
    logError.mockRestore();
    resetServiceGlobals();
  });
});
