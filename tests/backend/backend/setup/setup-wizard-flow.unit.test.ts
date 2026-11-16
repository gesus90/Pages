import { beforeEach, describe, expect, it, vi } from "vitest";

import { SetupWizardService } from "@/backend/setup/SetupWizardService";

import { partial } from "../../app/lib/service-wiring-fakes";

import type { PagesRuntime } from "@/backend/runtime/PagesRuntime";
import type { SetupInput } from "@/backend/setup/SetupWizardService";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  retire: vi.fn(),
  fingerprint: vi.fn(),
  committed: vi.fn(),
  initialize: vi.fn(),
  renew: vi.fn(),
}));
vi.mock("@/backend/database/Database", () => ({
  Database: { connect: mocks.connect },
}));
vi.mock("@/backend/setup/SetupIntent", () => ({
  readSetupIntent: mocks.read,
  createSetupIntent: mocks.create,
  retireSetupIntent: mocks.retire,
  setupFingerprint: mocks.fingerprint,
}));
vi.mock("@/backend/setup/SetupPostgresRepository", () => ({
  hasCommittedSetup: mocks.committed,
  initializeSetupDatabase: mocks.initialize,
  renewSetupSession: mocks.renew,
  SetupDatabaseNotEmptyError: class extends Error {},
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
}));
vi.mock("@/backend/logging/LogRedaction", () => ({
  registerLogSecret: vi.fn(),
}));

const input: SetupInput = {
  companyName: "Company",
  username: "owner",
  password: "secret",
  email: null,
  databaseUrl: "postgres://localhost/pages",
  language: "en",
  userAgent: null,
};

function fixture(
  overrides: {
    isSetupPending?: () => boolean;
    verifySetupToken?: () => boolean;
  } = {},
): {
  service: SetupWizardService;
  runtime: PagesRuntime;
  activate: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  const close = vi.fn().mockResolvedValue(undefined);
  mocks.connect.mockResolvedValue({ close });
  const configFile = partial<PagesRuntime["configFile"]>({
    path: "/virtual/config",
    update: vi.fn().mockResolvedValue({ firstRun: false }),
    write: vi.fn().mockResolvedValue(undefined),
  });
  const runtime = partial<PagesRuntime>({
    configFile,
    runExclusiveSetup: async <Result>(
      task: () => Promise<Result>,
    ): Promise<Result> => task(),
    isSetupPending: () => true,
    verifySetupToken: () => true,
    getSuggestedDatabasePath: () => "/virtual/db",
    getConfig: vi.fn().mockReturnValue({ firstRun: true }),
    stageSetup: vi.fn(),
    finishSetup: vi.fn(),
    ...overrides,
  });
  const activate = vi.fn().mockResolvedValue(undefined);
  const service = new SetupWizardService({
    runtime,
    passwordHasher: partial({ hash: vi.fn().mockResolvedValue("hash") }),
    activateServices: activate,
  });
  return { service, runtime, activate, close };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue(null);
  mocks.create.mockResolvedValue({ sessionToken: "session" });
  mocks.committed.mockResolvedValue(false);
  mocks.initialize.mockResolvedValue("session");
  mocks.retire.mockResolvedValue(undefined);
});

describe("setup wizard completion", () => {
  it("rejects completed setups, invalid tokens and invalid database URLs", async () => {
    const service = new SetupWizardService({
      runtime: fixture({ isSetupPending: () => false }).runtime,
      passwordHasher: partial({}),
      activateServices: vi.fn(),
    });
    await expect(service.complete(input, "token")).resolves.toEqual({
      status: "alreadyCompleted",
    });
    const denied = new SetupWizardService({
      runtime: fixture({ verifySetupToken: () => false }).runtime,
      passwordHasher: partial({}),
      activateServices: vi.fn(),
    });
    await expect(denied.complete(input, "token")).resolves.toEqual({
      status: "invalidToken",
    });
    const valid = fixture().service;
    await expect(
      valid.complete({ ...input, databaseUrl: "file:///bad" }, "token"),
    ).resolves.toMatchObject({ status: "databaseLocation" });
  });

  it("initializes and activates a new setup", async () => {
    const { service, runtime, activate, close } = fixture();
    await expect(service.complete(input, "token")).resolves.toEqual({
      status: "completed",
      sessionToken: "session",
    });
    expect(activate).toHaveBeenCalledOnce();
    expect(runtime.finishSetup).toHaveBeenCalledOnce();
    expect(mocks.retire).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it("rolls back staged configuration when activation fails", async () => {
    const { service, runtime, activate, close } = fixture();
    activate.mockRejectedValue(new Error("unavailable"));
    await expect(service.complete(input, "token")).resolves.toEqual({
      status: "failed",
    });
    expect(runtime.configFile.write).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("refuses an existing intent bound to different input", async () => {
    const { service } = fixture();
    mocks.read.mockResolvedValue({
      databaseUrl: "postgres://different",
      fingerprint: "other",
      sessionToken: "session",
    });
    await expect(service.complete(input, "token")).resolves.toEqual({
      status: "failed",
    });
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
