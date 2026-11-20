import { beforeEach, expect, it, vi } from "vitest";

import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { ConfigFile } from "@/backend/config/ConfigFile";
import { DEFAULT_CONFIG } from "@/backend/config/PagesConfig";
import { PagesRuntime } from "@/backend/runtime/PagesRuntime";
import { DATABASE_LOCATION_STATUS } from "@/definition/Setup";

import { SetupWizardService } from "./SetupWizardService";
import { SetupDatabaseNotEmptyError } from "./SetupPostgresRepository";

import type { SetupInput } from "./SetupWizardService";

const boundary = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  retire: vi.fn(),
  fingerprint: vi.fn(),
  committed: vi.fn(),
  initialize: vi.fn(),
  renew: vi.fn(),
}));
vi.mock("@/backend/database/Database", () => ({
  Database: { connect: boundary.connect },
}));
vi.mock("@/backend/database/Migrations", () => ({ POSTGRES_MIGRATIONS: [] }));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
  logEvent: vi.fn(),
  updateLogRetention: vi.fn(),
}));
vi.mock("./SetupIntent", () => ({
  readSetupIntent: boundary.read,
  createSetupIntent: boundary.create,
  retireSetupIntent: boundary.retire,
  setupFingerprint: boundary.fingerprint,
}));
vi.mock("./SetupPostgresRepository", () => ({
  hasCommittedSetup: boundary.committed,
  initializeSetupDatabase: boundary.initialize,
  renewSetupSession: boundary.renew,
  SetupDatabaseNotEmptyError: class extends Error {},
}));

const input: SetupInput = {
  companyName: "Company",
  username: "admin",
  password: "password",
  email: null,
  databaseUrl: "postgres://localhost/synthetic",
  language: "en",
  userAgent: null,
};

function fixture(): {
  runtime: PagesRuntime;
  activateServices: ReturnType<typeof vi.fn>;
  service: SetupWizardService;
} {
  const file = new ConfigFile("/synthetic/config.json");
  const runtime = new PagesRuntime(file, DEFAULT_CONFIG);
  vi.spyOn(file, "update").mockImplementation(async (change) =>
    change(DEFAULT_CONFIG),
  );
  vi.spyOn(file, "write").mockResolvedValue(undefined);
  const hasher = new PasswordHasher();
  vi.spyOn(hasher, "hash").mockResolvedValue("hashed");
  const activateServices = vi.fn().mockResolvedValue(undefined);
  return {
    runtime,
    activateServices,
    service: new SetupWizardService({
      runtime,
      passwordHasher: hasher,
      activateServices,
    }),
  };
}

beforeEach(() => {
  for (const mock of Object.values(boundary)) mock.mockReset();
  boundary.connect.mockResolvedValue({ close: boundary.close });
  boundary.close.mockResolvedValue(undefined);
  boundary.read.mockResolvedValue(null);
  boundary.create.mockResolvedValue({
    sessionToken: "session",
    databaseUrl: input.databaseUrl,
    fingerprint: "fp",
  });
  boundary.fingerprint.mockReturnValue("fp");
  boundary.committed.mockResolvedValue(false);
  boundary.initialize.mockResolvedValue("session");
  boundary.renew.mockResolvedValue(undefined);
  boundary.retire.mockResolvedValue(undefined);
});

it("checks pending status, token and database URL before opening a database", async () => {
  const { service, runtime } = fixture();
  expect(await service.complete(input, "wrong")).toEqual({
    status: "invalidToken",
  });
  expect(
    await service.complete(
      { ...input, databaseUrl: "invalid" },
      runtime.getSetupToken(),
    ),
  ).toEqual({
    status: "databaseLocation",
    location: DATABASE_LOCATION_STATUS.INVALID,
  });
  vi.spyOn(runtime, "isSetupPending").mockReturnValue(false);
  expect(await service.complete(input, "token")).toEqual({
    status: "alreadyCompleted",
  });
  expect(boundary.connect).not.toHaveBeenCalled();
});

it("initializes a new setup, activates services and retires its intent", async () => {
  const { service, runtime, activateServices } = fixture();
  expect(await service.complete(input, runtime.getSetupToken())).toEqual({
    status: "completed",
    sessionToken: "session",
  });
  expect(boundary.initialize).toHaveBeenCalledWith(
    expect.anything(),
    [],
    expect.objectContaining({ passwordHash: "hashed" }),
    "session",
  );
  expect(activateServices).toHaveBeenCalledOnce();
  expect(boundary.retire).toHaveBeenCalledOnce();
  expect(boundary.close).not.toHaveBeenCalled();
  expect(runtime.isSetupPending()).toBe(false);
});

it("recovers a committed setup and keeps it completed when intent retirement fails", async () => {
  const { service, runtime } = fixture();
  boundary.read.mockResolvedValue({
    sessionToken: "session",
    databaseUrl: input.databaseUrl,
    fingerprint: "fp",
  });
  boundary.committed.mockResolvedValue(true);
  boundary.retire.mockRejectedValue(new Error("file error"));
  expect(await service.complete(input, runtime.getSetupToken())).toEqual({
    status: "completed",
    sessionToken: "session",
  });
  expect(boundary.renew).toHaveBeenCalledOnce();
  expect(boundary.initialize).not.toHaveBeenCalled();
});

it("rejects a different pending intent and rolls back failed activation", async () => {
  const first = fixture();
  boundary.read.mockResolvedValueOnce({
    sessionToken: "session",
    databaseUrl: "postgres://other/db",
    fingerprint: "fp",
  });
  expect(
    await first.service.complete(input, first.runtime.getSetupToken()),
  ).toEqual({ status: "failed" });
  expect(boundary.connect).not.toHaveBeenCalled();
  const second = fixture();
  second.activateServices.mockRejectedValue(new Error("activation failed"));
  expect(
    await second.service.complete(input, second.runtime.getSetupToken()),
  ).toEqual({ status: "failed" });
  expect(second.runtime.configFile.write).toHaveBeenCalledWith(DEFAULT_CONFIG);
  expect(boundary.close).toHaveBeenCalledOnce();
});

it("refuses occupied databases and retires only a newly created intent", async () => {
  const first = fixture();
  boundary.initialize.mockRejectedValueOnce(new SetupDatabaseNotEmptyError());
  expect(
    await first.service.complete(input, first.runtime.getSetupToken()),
  ).toEqual({
    status: "databaseLocation",
    location: DATABASE_LOCATION_STATUS.FOREIGN,
  });
  expect(boundary.retire).toHaveBeenCalledOnce();
  boundary.retire.mockClear();
  boundary.read.mockResolvedValueOnce({
    sessionToken: "session",
    databaseUrl: input.databaseUrl,
    fingerprint: "fp",
  });
  boundary.initialize.mockRejectedValueOnce(new SetupDatabaseNotEmptyError());
  const second = fixture();
  expect(
    await second.service.complete(input, second.runtime.getSetupToken()),
  ).toEqual({
    status: "databaseLocation",
    location: DATABASE_LOCATION_STATUS.FOREIGN,
  });
  expect(boundary.retire).not.toHaveBeenCalled();
  boundary.initialize.mockRejectedValueOnce(new Error("write failed"));
  const third = fixture();
  expect(
    await third.service.complete(input, third.runtime.getSetupToken()),
  ).toEqual({ status: "failed" });
  expect(boundary.retire).not.toHaveBeenCalled();
});

it("closes the database when the configuration remains pending", async () => {
  const { service, runtime } = fixture();
  vi.mocked(runtime.configFile.update).mockResolvedValueOnce(DEFAULT_CONFIG);
  expect(await service.complete(input, runtime.getSetupToken())).toEqual({
    status: "failed",
  });
  expect(boundary.close).toHaveBeenCalledOnce();
});
