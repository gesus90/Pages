import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { UserRepository } from "./UserRepository";

import type { NewUser } from "./UserRepository";
import type { Database } from "@/backend/database/Database";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const USER_ROW = [
  "u",
  "ada",
  "Ada",
  "admin",
  1,
  "initials",
  null,
  "red",
  null,
  0,
  "person",
];

interface Harness {
  readonly execute: Mock;
  readonly query: Mock;
  readonly repository: UserRepository;
}

function repositoryOf(rows: unknown[][] = []): Harness {
  const execute = vi.fn(async () => undefined);
  const query = vi.fn(async () => rows);
  const database = {
    execute,
    query,
    transaction: async (work: (scope: unknown) => Promise<unknown>) =>
      work({ execute, query }),
  };
  return {
    execute,
    query,
    repository: new UserRepository(
      database as unknown as Pick<
        Database,
        "query" | "execute" | "transaction"
      >,
    ),
  };
}

function uniqueViolation(column: string): Error {
  return Object.assign(new Error("duplicate"), {
    code: "23505",
    detail: `Key (${column})=(x) already exists.`,
  });
}

const NEW_USER: NewUser = {
  id: "u",
  username: "ada",
  displayName: "Ada",
  passwordHash: "p",
  role: "employee",
};

it("maps users and agents", async () => {
  const user = await repositoryOf([USER_ROW]).repository.findById("u");
  expect(user).toEqual({
    id: "u",
    username: "ada",
    displayName: "Ada",
    role: "admin",
    isActive: true,
    mustChangePassword: false,
    avatarType: "initials",
    avatarIcon: null,
    avatarColor: "red",
    avatarImageUrl: null,
  });
  const agent = await repositoryOf([
    [...USER_ROW.slice(0, 10), "agent"],
  ]).repository.findByEmail("e");
  expect(agent).toMatchObject({ isAgent: true });
  await expect(repositoryOf().repository.findById("u")).resolves.toBeNull();
  await expect(repositoryOf().repository.findByEmail("e")).resolves.toBeNull();
});

it("rejects unsupported roles and avatar types", async () => {
  await expect(
    repositoryOf([
      ["u", "a", "A", "king", 1, "initials", null, null, null, 0, "person"],
    ]).repository.findById("u"),
  ).rejects.toThrow('unsupported role "king"');
  await expect(
    repositoryOf([
      ["u", "a", "A", "admin", 1, "hologram", null, null, null, 0, "person"],
    ]).repository.findById("u"),
  ).rejects.toThrow('unsupported avatar type "hologram"');
});

it("lists all users", async () => {
  const { repository, query } = repositoryOf([USER_ROW]);
  await expect(repository.findAll()).resolves.toHaveLength(1);
  await repository.findAll(true);
  expect(query).toHaveBeenLastCalledWith(expect.any(String), {
    include_removed_agents: true,
  });
});

it("reads emails by user ids", async () => {
  await expect(
    repositoryOf().repository.findEmailsByUserIds([]),
  ).resolves.toEqual(new Map());
  const { repository, query } = repositoryOf([
    ["a", "a@x"],
    ["b", null],
  ]);
  await expect(repository.findEmailsByUserIds(["a", "b"])).resolves.toEqual(
    new Map([
      ["a", "a@x"],
      ["b", null],
    ]),
  );
  expect(query).toHaveBeenCalledWith(expect.stringContaining("$id_0, $id_1"), {
    id_0: "a",
    id_1: "b",
  });
});

it("finds credentials by username", async () => {
  const found = await repositoryOf([
    [...USER_ROW, "hash"],
  ]).repository.findCredentialsByUsername("ADA");
  expect(found?.passwordHash).toBe("hash");
  await expect(
    repositoryOf().repository.findCredentialsByUsername("x"),
  ).resolves.toBeNull();
});

it("inserts users with defaults and explicit values", async () => {
  const { repository, execute } = repositoryOf();
  await repository.insert(NEW_USER);
  expect(execute).toHaveBeenNthCalledWith(
    1,
    expect.stringContaining("INSERT INTO users"),
    expect.objectContaining({
      email: null,
      is_active: true,
      must_change_password: false,
      created_at: null,
    }),
  );
  await repository.insert({
    ...NEW_USER,
    email: "e",
    isActive: false,
    mustChangePassword: true,
    createdAt: "t",
  });
  expect(execute).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      email: "e",
      is_active: false,
      must_change_password: true,
      created_at: "t",
    }),
  );
});

it("maps duplicate usernames on insert and rethrows others", async () => {
  for (const column of ["username", "lower(username)"]) {
    const { repository, execute } = repositoryOf();
    execute.mockRejectedValueOnce(uniqueViolation(column));
    await expect(repository.insert(NEW_USER)).rejects.toThrow("already taken");
  }
  const { repository, execute } = repositoryOf();
  execute.mockRejectedValueOnce(new Error("boom"));
  await expect(repository.insert(NEW_USER)).rejects.toThrow("boom");
});

it("activates and deactivates users", async () => {
  const { repository, execute } = repositoryOf();
  await repository.setActive("u", true);
  expect(execute).toHaveBeenCalledTimes(1);
  await repository.setActive("u", false);
  expect(execute).toHaveBeenCalledTimes(5);
});

it("updates profiles", async () => {
  const { repository, execute } = repositoryOf();
  await repository.updateProfile("u", {
    displayName: "A",
    username: "a",
    email: null,
  });
  await repository.updateProfile("u", {
    displayName: "A",
    username: "a",
    email: "e",
    avatarType: "image",
    avatarImageUrl: "url",
  });
  expect(execute).toHaveBeenNthCalledWith(
    1,
    expect.any(String),
    expect.objectContaining({ avatar_type: null, avatar_image_url: null }),
  );
  expect(execute).toHaveBeenNthCalledWith(
    2,
    expect.any(String),
    expect.objectContaining({ avatar_type: "image", avatar_image_url: "url" }),
  );
});

it("maps profile constraint violations", async () => {
  const profile = { displayName: "A", username: "a", email: "e" };
  const failing = (error: Error): UserRepository => {
    const result = repositoryOf();
    result.execute.mockRejectedValueOnce(error);
    return result.repository;
  };
  await expect(
    failing(uniqueViolation("username")).updateProfile("u", profile),
  ).rejects.toThrow("username");
  await expect(
    failing(uniqueViolation("email")).updateProfile("u", profile),
  ).rejects.toThrow("email address");
  await expect(
    failing(uniqueViolation("email")).updateProfile("u", {
      ...profile,
      email: null,
    }),
  ).rejects.toThrow("duplicate");
  await expect(
    failing(new Error("boom")).updateProfile("u", profile),
  ).rejects.toThrow("boom");
});

it("updates avatar references, role and passwords", async () => {
  const { repository, execute } = repositoryOf();
  await repository.updateAvatarReference("u", {
    avatarType: "icon",
    avatarImageUrl: null,
  });
  await repository.updateRole("u", "manager");
  await repository.updatePasswordHash("u", "h");
  await repository.resetPasswordHash("u", "h");
  expect(execute).toHaveBeenCalledTimes(5);
});

it("reads stored avatars", async () => {
  const image = Buffer.from("x");
  await expect(
    repositoryOf([["image/png", "a.png", image]]).repository.findAvatarByUserId(
      "u",
    ),
  ).resolves.toEqual({
    mimeType: "image/png",
    filename: "a.png",
    data: image,
  });
  await expect(
    repositoryOf().repository.findAvatarByUserId("u"),
  ).resolves.toBeNull();
});

it("reads avatar digests as text or bytes", async () => {
  await expect(
    repositoryOf([["image/png", "abcd"]]).repository.findAvatarDigestByUserId(
      "u",
    ),
  ).resolves.toEqual({
    mimeType: "image/png",
    sha256: "abcd",
  });
  await expect(
    repositoryOf([
      ["image/png", Buffer.from([0xab, 0xcd])],
    ]).repository.findAvatarDigestByUserId("u"),
  ).resolves.toEqual({ mimeType: "image/png", sha256: "abcd" });
  await expect(
    repositoryOf().repository.findAvatarDigestByUserId("u"),
  ).resolves.toBeNull();
});

it("reads image avatar digests of several users", async () => {
  await expect(
    repositoryOf().repository.findImageAvatarDigestsByUserIds([]),
  ).resolves.toEqual(new Map());
  const { repository } = repositoryOf([["u", "image/png", "ff"]]);
  await expect(
    repository.findImageAvatarDigestsByUserIds(["u"]),
  ).resolves.toEqual(new Map([["u", { mimeType: "image/png", sha256: "ff" }]]));
});

it("upserts and deletes avatars", async () => {
  const { repository, execute } = repositoryOf();
  const image = Buffer.from("x");
  await repository.upsertAvatar("u", {
    mimeType: "image/png",
    filename: "a",
    data: image,
  });
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO user_avatars"),
    { user_id: "u", mime_type: "image/png", filename: "a", data: image },
  );
  await repository.deleteAvatar("u");
  expect(execute).toHaveBeenCalledTimes(3);
});

it("counts active administrators", async () => {
  await expect(
    repositoryOf([[3]]).repository.countActiveAdministrators(),
  ).resolves.toBe(3);
  await expect(
    repositoryOf().repository.countActiveAdministrators(),
  ).rejects.toThrow("no administrator count");
});
