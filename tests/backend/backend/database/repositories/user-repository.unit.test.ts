import { expect, it, vi } from "vitest";

import { UserRepository } from "@/backend/database/repositories/UserRepository";
import {
  EmailTakenError,
  UsernameTakenError,
} from "@/backend/error/UserErrors";

import { scriptedDatabase } from "./scripted-database";

import type { DatabaseValue } from "@/backend/database/Database";
import type { NewUser } from "@/backend/database/repositories/UserRepository";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const USER_ROW: DatabaseValue[] = [
  "user-1",
  "ada",
  "Ada Lovelace",
  "admin",
  1,
  "image",
  null,
  "#ffaa00",
  "/avatar/user-1",
  0,
];

const USER = {
  id: "user-1",
  username: "ada",
  displayName: "Ada Lovelace",
  role: "admin",
  isActive: true,
  mustChangePassword: false,
  avatarType: "image",
  avatarIcon: null,
  avatarColor: "#ffaa00",
  avatarImageUrl: "/avatar/user-1",
};

const NEW_USER: NewUser = {
  id: "user-2",
  username: "grace",
  displayName: "Grace Hopper",
  passwordHash: "hash",
  role: "employee",
  authorization: {
    roleId: "role-1",
    isAdmin: false,
    mode: "role",
    firstName: "Grace",
    lastName: "Hopper",
  },
};

function duplicate(column: string): Error {
  return new Error(`Constraint Error: Duplicate key "${column}: grace"`);
}

it("finds a user by id or email and returns null for unknown accounts", async () => {
  const scripted = scriptedDatabase();
  scripted.answer([USER_ROW], [], [USER_ROW], []);
  const repository = new UserRepository(scripted.database);

  await expect(repository.findById("user-1")).resolves.toEqual(USER);
  await expect(repository.findById("missing")).resolves.toBeNull();
  await expect(repository.findByEmail("ada@example.org")).resolves.toEqual(
    USER,
  );
  await expect(repository.findByEmail("none@example.org")).resolves.toBeNull();
  expect(scripted.statements[2]?.parameters).toEqual({
    email: "ada@example.org",
  });
});

it("lists every user and refuses unsupported roles or avatar types", async () => {
  const scripted = scriptedDatabase();
  const unknownRole = [...USER_ROW];
  unknownRole[3] = "owner";
  const unknownAvatar = [...USER_ROW];
  unknownAvatar[5] = "emoji";
  scripted.answer([USER_ROW], [unknownRole], [unknownAvatar]);
  const repository = new UserRepository(scripted.database);

  await expect(repository.findAll()).resolves.toEqual([USER]);
  await expect(repository.findAll()).rejects.toThrow(
    'unsupported role "owner"',
  );
  await expect(repository.findAll()).rejects.toThrow(
    'unsupported avatar type "emoji"',
  );
});

it("reads emails per user with one placeholder per id and skips the query for none", async () => {
  const scripted = scriptedDatabase();
  scripted.answer([
    ["user-1", "ada@example.org"],
    ["user-2", null],
  ]);
  const repository = new UserRepository(scripted.database);

  await expect(repository.findEmailsByUserIds([])).resolves.toEqual(new Map());
  await expect(
    repository.findEmailsByUserIds(["user-1", "user-2"]),
  ).resolves.toEqual(
    new Map([
      ["user-1", "ada@example.org"],
      ["user-2", null],
    ]),
  );
  expect(scripted.statements).toHaveLength(1);
  expect(scripted.statements[0]?.statement).toContain("IN ($id_0, $id_1)");
  expect(scripted.statements[0]?.parameters).toEqual({
    id_0: "user-1",
    id_1: "user-2",
  });
});

it("returns credentials for a username or null when nobody uses it", async () => {
  const scripted = scriptedDatabase();
  scripted.answer([[...USER_ROW, "stored-hash"]], []);
  const repository = new UserRepository(scripted.database);

  await expect(repository.findCredentialsByUsername("ADA")).resolves.toEqual({
    user: USER,
    passwordHash: "stored-hash",
  });
  await expect(
    repository.findCredentialsByUsername("nobody"),
  ).resolves.toBeNull();
});

it("inserts a user with explicit values and its authorization in one transaction", async () => {
  const scripted = scriptedDatabase();

  await new UserRepository(scripted.database).insert({
    ...NEW_USER,
    email: "grace@example.org",
    isActive: false,
    mustChangePassword: true,
    createdAt: "2026-10-01T00:00:00.000Z",
  });

  expect(scripted.transactions()).toBe(1);
  expect(scripted.statements[0]?.parameters).toEqual({
    id: "user-2",
    username: "grace",
    display_name: "Grace Hopper",
    password_hash: "hash",
    email: "grace@example.org",
    role: "employee",
    is_active: false,
    must_change_password: true,
    created_at: "2026-10-01T00:00:00.000Z",
  });
  expect(scripted.statements[1]?.statement).toContain(
    "INSERT INTO user_authorization",
  );
  expect(scripted.statements.every((entry) => entry.inTransaction)).toBe(true);
});

it("inserts a user with defaults for the optional values", async () => {
  const scripted = scriptedDatabase();

  await new UserRepository(scripted.database).insert(NEW_USER);

  expect(scripted.statements[0]?.parameters).toMatchObject({
    email: null,
    is_active: true,
    must_change_password: false,
    created_at: null,
  });
});

it("translates username conflicts on insert and rethrows other failures", async () => {
  const scripted = scriptedDatabase();
  const repository = new UserRepository(scripted.database);
  const unrelated = new Error("disk full");
  scripted.failNextExecute(duplicate("username"));
  await expect(repository.insert(NEW_USER)).rejects.toBeInstanceOf(
    UsernameTakenError,
  );
  scripted.failNextExecute(duplicate("lower(username)"));
  await expect(repository.insert(NEW_USER)).rejects.toBeInstanceOf(
    UsernameTakenError,
  );
  scripted.failNextExecute(unrelated);
  await expect(repository.insert(NEW_USER)).rejects.toBe(unrelated);
});

it("activates a user without touching tokens, sessions or group memberships", async () => {
  const scripted = scriptedDatabase();

  await new UserRepository(scripted.database).setActive("user-1", true);

  expect(scripted.statements).toHaveLength(1);
  expect(scripted.statements[0]?.parameters).toEqual({
    id: "user-1",
    is_active: true,
  });
});

it("deactivates a user and revokes tokens, sessions and group memberships", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  const scripted = scriptedDatabase();

  await new UserRepository(scripted.database).setActive("user-1", false);

  expect(scripted.statements.map((entry) => entry.statement)).toEqual([
    expect.stringContaining("UPDATE users"),
    expect.stringContaining("UPDATE personal_agent_tokens"),
    expect.stringContaining("DELETE FROM sessions"),
    expect.stringContaining("DELETE FROM user_group_members"),
  ]);
  expect(scripted.statements[1]?.parameters).toEqual({
    id: "user-1",
    now: 1_700_000_000_000,
  });
  expect(scripted.transactions()).toBe(1);
});

it("updates a profile and keeps avatar columns when no avatar is given", async () => {
  const scripted = scriptedDatabase();
  const repository = new UserRepository(scripted.database);

  await repository.updateProfile("user-1", {
    displayName: "Ada",
    username: "ada",
    email: null,
  });
  await repository.updateProfile("user-1", {
    displayName: "Ada",
    username: "ada",
    email: "ada@example.org",
    avatarType: "icon",
    avatarImageUrl: "/avatar",
  });

  expect(scripted.statements[0]?.parameters).toEqual({
    id: "user-1",
    display_name: "Ada",
    username: "ada",
    email: null,
    avatar_type: null,
    avatar_image_url: null,
  });
  expect(scripted.statements[1]?.parameters).toMatchObject({
    email: "ada@example.org",
    avatar_type: "icon",
    avatar_image_url: "/avatar",
  });
});

it("translates username and email conflicts of a profile update", async () => {
  const scripted = scriptedDatabase();
  const repository = new UserRepository(scripted.database);
  const profile = {
    displayName: "Grace",
    username: "grace",
    email: "grace@example.org",
  };
  scripted.failNextExecute(duplicate("username"));
  await expect(
    repository.updateProfile("user-2", profile),
  ).rejects.toBeInstanceOf(UsernameTakenError);
  scripted.failNextExecute(duplicate("email"));
  await expect(
    repository.updateProfile("user-2", profile),
  ).rejects.toBeInstanceOf(EmailTakenError);
});

it("rethrows profile failures that are not a conflict of the given values", async () => {
  const scripted = scriptedDatabase();
  const repository = new UserRepository(scripted.database);
  const emailConflict = duplicate("email");
  const unrelated = new Error("disk full");
  scripted.failNextExecute(emailConflict);
  await expect(
    repository.updateProfile("user-2", {
      displayName: "Grace",
      username: "grace",
      email: null,
    }),
  ).rejects.toBe(emailConflict);
  scripted.failNextExecute(unrelated);
  await expect(
    repository.updateProfile("user-2", {
      displayName: "Grace",
      username: "grace",
      email: "grace@example.org",
    }),
  ).rejects.toBe(unrelated);
});

it("stores avatar references, roles and password hashes for one user", async () => {
  const scripted = scriptedDatabase();
  const repository = new UserRepository(scripted.database);

  await repository.updateAvatarReference("user-1", {
    avatarType: "initials",
    avatarImageUrl: null,
  });
  await repository.updateRole("user-1", "manager");
  await repository.updatePasswordHash("user-1", "new-hash");

  expect(scripted.statements.map((entry) => entry.parameters)).toEqual([
    { id: "user-1", avatar_type: "initials", avatar_image_url: null },
    { id: "user-1", role: "manager" },
    { id: "user-1", password_hash: "new-hash" },
  ]);
  expect(scripted.statements[2]?.statement).toContain(
    "must_change_password = 0",
  );
});

it("reads a stored avatar image or null and upserts a new one", async () => {
  const scripted = scriptedDatabase();
  const imageBytes = Buffer.from("png");
  scripted.answer([["image/png", "ada.png", imageBytes]], []);
  const repository = new UserRepository(scripted.database);

  await expect(repository.findAvatarByUserId("user-1")).resolves.toEqual({
    mimeType: "image/png",
    filename: "ada.png",
    data: imageBytes,
  });
  await expect(repository.findAvatarByUserId("user-2")).resolves.toBeNull();
  await repository.upsertAvatar("user-1", {
    mimeType: "image/png",
    filename: "ada.png",
    data: imageBytes,
  });
  expect(scripted.statements[2]?.parameters).toEqual({
    user_id: "user-1",
    mime_type: "image/png",
    filename: "ada.png",
    data: imageBytes,
  });
});

it("resets a password and ends every session of the user in one transaction", async () => {
  const scripted = scriptedDatabase();

  await new UserRepository(scripted.database).resetPasswordHash(
    "user-1",
    "temporary",
  );

  expect(scripted.transactions()).toBe(1);
  expect(scripted.statements.map((entry) => entry.statement)).toEqual([
    expect.stringContaining("must_change_password = 1"),
    expect.stringContaining("DELETE FROM sessions"),
  ]);
});

it("counts active administrators and fails when the database returns no count", async () => {
  const scripted = scriptedDatabase();
  scripted.answer([[2n]], []);
  const repository = new UserRepository(scripted.database);

  await expect(repository.countActiveAdministrators()).resolves.toBe(2);
  await expect(repository.countActiveAdministrators()).rejects.toThrow(
    "no administrator count",
  );
});
