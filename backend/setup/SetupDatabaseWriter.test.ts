import { beforeEach, expect, it, vi } from "vitest";

import { Database } from "@/backend/database/Database";

import { SetupDatabaseWriter } from "./SetupDatabaseWriter";

import type { SetupRecord } from "./SetupDatabaseWriter";

const boundary = vi.hoisted(() => ({
  find: vi.fn(),
  email: vi.fn(),
  insert: vi.fn(),
  profile: vi.fn(),
  password: vi.fn(),
  active: vi.fn(),
  role: vi.fn(),
  snapshot: vi.fn(),
  administrator: vi.fn(),
  deleteSessions: vi.fn(),
  session: vi.fn(),
  settings: vi.fn(),
  language: vi.fn(),
}));
vi.mock("@/backend/database/Database", () => ({
  Database: { connect: async () => ({}) },
}));
vi.mock("@/backend/database/repositories/UserRepository", () => ({
  UserRepository: class {
    public findCredentialsByUsername = boundary.find;
    public findByEmail = boundary.email;
    public insert = boundary.insert;
    public updateProfile = boundary.profile;
    public updatePasswordHash = boundary.password;
    public setActive = boundary.active;
    public updateRole = boundary.role;
  },
}));
vi.mock("@/backend/database/repositories/AuthorizationRepository", () => ({
  AuthorizationRepository: class {
    public snapshot = boundary.snapshot;
    public activateAdministrator = boundary.administrator;
  },
}));
vi.mock("@/backend/database/repositories/SessionRepository", () => ({
  SessionRepository: class {
    public deleteAllByUserId = boundary.deleteSessions;
  },
}));
vi.mock("@/backend/database/repositories/InstanceSettingsRepository", () => ({
  InstanceSettingsRepository: class {
    public save = boundary.settings;
  },
}));
vi.mock("@/backend/database/repositories/UserSettingsRepository", () => ({
  UserSettingsRepository: class {
    public upsertLanguage = boundary.language;
  },
}));
vi.mock("@/backend/auth/SessionService", () => ({
  SessionService: class {
    public createSession = boundary.session;
  },
}));
vi.mock("@/backend/service/UserService", () => ({ UserService: class {} }));
vi.mock("@/backend/auth/PermissionService", () => ({
  PermissionService: class {},
}));

const record: SetupRecord = {
  companyName: "Company",
  username: "admin",
  email: "a@example.invalid",
  passwordHash: "hash",
  language: "en",
  userAgent: "browser",
};

beforeEach(() => {
  for (const mock of Object.values(boundary)) mock.mockReset();
  boundary.find.mockResolvedValue(null);
  boundary.email.mockResolvedValue(null);
  boundary.snapshot.mockResolvedValue({ accounts: [] });
  boundary.session.mockResolvedValue("session");
});

it("creates an administrator and returns a session", async () => {
  const writer = new SetupDatabaseWriter(await Database.connect("synthetic"));
  expect(await writer.write(record)).toEqual({
    status: "written",
    sessionToken: "session",
  });
  expect(boundary.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      username: "admin",
      email: record.email,
      role: "admin",
    }),
  );
  expect(boundary.settings).toHaveBeenCalledWith(
    expect.objectContaining({ companyName: "Company" }),
  );
  expect(boundary.session).toHaveBeenCalledWith(expect.any(String), "browser");
});

it("refuses a non-admin username or another user's email", async () => {
  const writer = new SetupDatabaseWriter(await Database.connect("synthetic"));
  boundary.find.mockResolvedValueOnce({
    user: { id: "u", displayName: "User" },
  });
  expect(await writer.write(record)).toEqual({ status: "usernameTaken" });
  boundary.email.mockResolvedValueOnce({ id: "other" });
  expect(await writer.write(record)).toEqual({ status: "emailTaken" });
  expect(boundary.insert).not.toHaveBeenCalled();
});

it("updates an existing administrator, retaining or replacing its email", async () => {
  const writer = new SetupDatabaseWriter(await Database.connect("synthetic"));
  boundary.find.mockResolvedValue({ user: { id: "u", displayName: "Admin" } });
  boundary.snapshot.mockResolvedValue({
    accounts: [{ userId: "u", isAdmin: true }],
  });
  boundary.email.mockResolvedValue({ id: "u" });
  expect(await writer.write(record)).toEqual({
    status: "written",
    sessionToken: "session",
  });
  expect(boundary.profile).toHaveBeenCalledOnce();
  expect(boundary.deleteSessions).toHaveBeenCalledWith("u");
  expect(boundary.administrator).toHaveBeenCalledWith("u");
  expect(boundary.password).toHaveBeenCalledWith("u", "hash");
  expect(boundary.active).toHaveBeenCalledWith("u", true);
  expect(boundary.role).toHaveBeenCalledWith("u", "admin");
  boundary.profile.mockClear();
  expect(await writer.write({ ...record, email: null })).toEqual({
    status: "written",
    sessionToken: "session",
  });
  expect(boundary.profile).not.toHaveBeenCalled();
});
