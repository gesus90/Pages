import { beforeEach, expect, it, vi } from "vitest";

import { SetupDatabaseWriter } from "@/backend/setup/SetupDatabaseWriter";

import { partial } from "../../app/lib/service-wiring-fakes";

import type { Database } from "@/backend/database/Database";

const mocks = vi.hoisted(() => ({
  findCredentialsByUsername: vi.fn(),
  findByEmail: vi.fn(),
  insert: vi.fn(),
  updateProfile: vi.fn(),
  updatePasswordHash: vi.fn(),
  setActive: vi.fn(),
  updateRole: vi.fn(),
  snapshot: vi.fn(),
  activateAdministrator: vi.fn(),
  deleteAllByUserId: vi.fn(),
  save: vi.fn(),
  upsertLanguage: vi.fn(),
  createSession: vi.fn(),
}));
vi.mock("@/backend/database/repositories/UserRepository", () => ({
  UserRepository: class {
    public readonly findCredentialsByUsername = mocks.findCredentialsByUsername;
    public readonly findByEmail = mocks.findByEmail;
    public readonly insert = mocks.insert;
    public readonly updateProfile = mocks.updateProfile;
    public readonly updatePasswordHash = mocks.updatePasswordHash;
    public readonly setActive = mocks.setActive;
    public readonly updateRole = mocks.updateRole;
  },
}));
vi.mock("@/backend/database/repositories/AuthorizationRepository", () => ({
  AuthorizationRepository: class {
    public readonly snapshot = mocks.snapshot;
    public readonly activateAdministrator = mocks.activateAdministrator;
  },
}));
vi.mock("@/backend/database/repositories/SessionRepository", () => ({
  SessionRepository: class {
    public readonly deleteAllByUserId = mocks.deleteAllByUserId;
  },
}));
vi.mock("@/backend/database/repositories/InstanceSettingsRepository", () => ({
  InstanceSettingsRepository: class {
    public readonly save = mocks.save;
  },
}));
vi.mock("@/backend/database/repositories/UserSettingsRepository", () => ({
  UserSettingsRepository: class {
    public readonly upsertLanguage = mocks.upsertLanguage;
  },
}));
vi.mock("@/backend/auth/SessionService", () => ({
  SessionService: class {
    public readonly createSession = mocks.createSession;
  },
}));

const RECORD = {
  companyName: "Company",
  username: "admin",
  email: "admin@example.test",
  passwordHash: "synthetic",
  language: "en" as const,
  userAgent: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findCredentialsByUsername.mockResolvedValue(null);
  mocks.findByEmail.mockResolvedValue(null);
  mocks.snapshot.mockResolvedValue({ accounts: [] });
  mocks.createSession.mockResolvedValue("session");
});

it("creates an administrator and persists settings before issuing a session", async () => {
  const result = await new SetupDatabaseWriter(partial<Database>({})).write(
    RECORD,
  );
  expect(result).toEqual({ status: "written", sessionToken: "session" });
  expect(mocks.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      username: "admin",
      role: "admin",
      passwordHash: "synthetic",
    }),
  );
  expect(mocks.save).toHaveBeenCalledWith(
    expect.objectContaining({ companyName: "Company" }),
  );
  expect(mocks.createSession).toHaveBeenCalledOnce();
});

it("does not promote an existing non-administrator or reuse another account's email", async () => {
  const writer = new SetupDatabaseWriter(partial<Database>({}));
  mocks.findCredentialsByUsername.mockResolvedValueOnce({
    user: { id: "existing" },
  });
  await expect(writer.write(RECORD)).resolves.toEqual({
    status: "usernameTaken",
  });
  mocks.findByEmail.mockResolvedValueOnce({ id: "other" });
  await expect(writer.write(RECORD)).resolves.toEqual({ status: "emailTaken" });
  expect(mocks.insert).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("refreshes an existing administrator and revokes older sessions", async () => {
  mocks.findCredentialsByUsername.mockResolvedValue({
    user: { id: "existing", displayName: "Admin" },
  });
  mocks.snapshot.mockResolvedValue({
    accounts: [{ userId: "existing", isAdmin: true }],
  });
  mocks.findByEmail.mockResolvedValue({ id: "existing" });
  await expect(
    new SetupDatabaseWriter(partial<Database>({})).write(RECORD),
  ).resolves.toEqual({ status: "written", sessionToken: "session" });
  expect(mocks.updatePasswordHash).toHaveBeenCalledWith(
    "existing",
    "synthetic",
  );
  expect(mocks.deleteAllByUserId).toHaveBeenCalledWith("existing");
  expect(mocks.activateAdministrator).toHaveBeenCalledWith("existing");
  expect(mocks.upsertLanguage).toHaveBeenCalledWith("existing", "en");
});
