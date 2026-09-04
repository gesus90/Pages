import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/database/Database", () => ({
  Database: {
    create: vi.fn(),
  },
}));

vi.mock("@/backend/database/DatabasePath", () => ({
  resolveDatabasePath: vi.fn(() => "/mocked/pages.duckdb"),
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
  migrate: ReturnType<typeof vi.fn>;
} {
  return {
    migrate: vi.fn().mockResolvedValue(undefined),
  };
}

function stubSetupEnsures(value: boolean): ReturnType<typeof vi.fn> {
  const ensureDefaultAdministrator = vi.fn().mockResolvedValue(value);
  mockedSetup.mockImplementation(function (this: unknown) {
    return { ensureDefaultAdministrator } as unknown as InstanceType<
      typeof mockedSetup
    >;
  });

  return ensureDefaultAdministrator;
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

describe("getApplicationServices", () => {
  beforeEach(() => {
    delete globalThis.pagesServices;
    vi.clearAllMocks();
    mockedDatabaseCreate.mockResolvedValue(
      createDatabase() as unknown as Awaited<
        ReturnType<typeof mockedDatabaseCreate>
      >,
    );
    stubSetupEnsures(false);
    stubSessionCleanup();
  });

  it("initializes services and reports a created administrator", async () => {
    const ensureDefaultAdministrator = stubSetupEnsures(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const services = await getApplicationServices();

    expect(mockedDatabaseCreate).toHaveBeenCalledWith("/mocked/pages.duckdb");
    expect(ensureDefaultAdministrator).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Created the default administrator "admin"'),
    );
    expect(services.authService).toBeDefined();
    expect(services.sessionService).toBeDefined();
    expect(mockedAuth).toHaveBeenCalledTimes(1);

    log.mockRestore();
    delete globalThis.pagesServices;
  });

  it("skips the creation message when the administrator exists", async () => {
    stubSetupEnsures(false);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await getApplicationServices();

    expect(log).not.toHaveBeenCalledWith(
      expect.stringContaining("Created the default administrator"),
    );

    log.mockRestore();
    delete globalThis.pagesServices;
  });

  it("reuses the initialized services for later callers", async () => {
    stubSetupEnsures(false);

    const first = await getApplicationServices();
    const second = await getApplicationServices();

    expect(second).toBe(first);
    expect(mockedDatabaseCreate).toHaveBeenCalledTimes(1);

    delete globalThis.pagesServices;
  });

  it("removes expired sessions during initialization", async () => {
    stubSetupEnsures(false);
    const removeExpiredSessions = stubSessionCleanup();

    await getApplicationServices();

    expect(removeExpiredSessions).toHaveBeenCalledTimes(1);

    delete globalThis.pagesServices;
  });

  it("propagates database initialization failures", async () => {
    mockedDatabaseCreate.mockRejectedValue(new Error("Disk unavailable"));

    await expect(getApplicationServices()).rejects.toThrow("Disk unavailable");

    delete globalThis.pagesServices;
  });
});
