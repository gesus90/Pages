import { describe, expect, it } from "vitest";

import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { ROLE } from "@/definition/Role";
import { USER_AVATAR_TYPE } from "@/definition/User";

import { useMigratedDatabase } from "../helpers/test-database";
import {
  EmailTakenError,
  UsernameTakenError,
} from "@/backend/error/UserErrors";

import type { NewUser } from "@/backend/database/repositories/UserRepository";

function createNewUser(overrides: Partial<NewUser> = {}): NewUser {
  return {
    displayName: "Anna Schmidt",
    id: "user-1",
    passwordHash: "stored-hash",
    role: ROLE.EMPLOYEE,
    username: "anna",
    ...overrides,
  };
}

describe("UserRepository on DuckDB", () => {
  const getDatabase = useMigratedDatabase();

  async function createRepository(): Promise<UserRepository> {
    const repository = new UserRepository(getDatabase());

    await repository.insert(
      createNewUser({ email: "anna@example.invalid", id: "user-1" }),
    );
    await repository.insert(
      createNewUser({ displayName: "Bob", id: "user-2", username: "bob" }),
    );

    return repository;
  }

  describe("usernames", () => {
    it("finds credentials whatever the case of the entered name", async () => {
      const repository = await createRepository();

      await expect(
        repository.findCredentialsByUsername("ANNA"),
      ).resolves.toMatchObject({ user: { id: "user-1", username: "anna" } });
    });

    it("returns null for a name nobody uses", async () => {
      const repository = await createRepository();

      await expect(repository.findCredentialsByUsername("carl")).resolves.toBe(
        null,
      );
    });

    it("rejects a new user whose name differs only by case", async () => {
      const repository = await createRepository();

      await expect(
        repository.insert(createNewUser({ id: "user-3", username: "Anna" })),
      ).rejects.toBeInstanceOf(UsernameTakenError);
    });

    it("rejects renaming a user to a name that differs only by case", async () => {
      const repository = await createRepository();

      await expect(
        repository.updateProfile("user-2", {
          displayName: "Bob",
          email: null,
          username: "ANNA",
        }),
      ).rejects.toBeInstanceOf(UsernameTakenError);
    });

    it("lets a user change the case of their own name", async () => {
      const repository = await createRepository();

      await repository.updateProfile("user-1", {
        displayName: "Anna Schmidt",
        email: null,
        username: "Anna",
      });

      await expect(repository.findById("user-1")).resolves.toMatchObject({
        username: "Anna",
      });
    });
  });

  describe("email lookups", () => {
    it("finds the user that owns an address", async () => {
      const repository = await createRepository();

      await expect(
        repository.findByEmail("anna@example.invalid"),
      ).resolves.toMatchObject({ id: "user-1", username: "anna" });
    });

    it("returns null for an address nobody uses", async () => {
      const repository = await createRepository();

      await expect(
        repository.findByEmail("none@example.invalid"),
      ).resolves.toBe(null);
    });

    it("returns the addresses of several users, null where unset", async () => {
      const repository = await createRepository();

      const emails = await repository.findEmailsByUserIds([
        "user-1",
        "user-2",
        "unknown",
      ]);

      expect(Object.fromEntries(emails)).toEqual({
        "user-1": "anna@example.invalid",
        "user-2": null,
      });
    });

    it("returns no addresses without requested users", async () => {
      const repository = await createRepository();

      await expect(repository.findEmailsByUserIds([])).resolves.toEqual(
        new Map(),
      );
    });
  });

  describe("updateProfile", () => {
    it("replaces display name, username and email", async () => {
      const repository = await createRepository();

      await repository.updateProfile("user-1", {
        displayName: "Anna Meier",
        email: "meier@example.invalid",
        username: "meier",
      });

      await expect(repository.findById("user-1")).resolves.toMatchObject({
        displayName: "Anna Meier",
        username: "meier",
      });
      await expect(
        repository.findByEmail("meier@example.invalid"),
      ).resolves.toMatchObject({ id: "user-1" });
    });

    it("keeps the avatar values that are not part of the change", async () => {
      const repository = await createRepository();

      await repository.updateAvatarReference("user-1", {
        avatarImageUrl: "/avatars/user-1",
        avatarType: USER_AVATAR_TYPE.IMAGE,
      });
      await repository.updateProfile("user-1", {
        displayName: "Anna",
        email: null,
        username: "anna",
      });

      await expect(repository.findById("user-1")).resolves.toMatchObject({
        avatarImageUrl: "/avatars/user-1",
        avatarType: USER_AVATAR_TYPE.IMAGE,
      });
    });

    it("replaces the avatar values that are part of the change", async () => {
      const repository = await createRepository();

      await repository.updateProfile("user-1", {
        avatarImageUrl: "/avatars/new",
        avatarType: USER_AVATAR_TYPE.IMAGE,
        displayName: "Anna",
        email: null,
        username: "anna",
      });

      await expect(repository.findById("user-1")).resolves.toMatchObject({
        avatarImageUrl: "/avatars/new",
        avatarType: USER_AVATAR_TYPE.IMAGE,
      });
    });

    it("rejects a username that another user owns", async () => {
      const repository = await createRepository();

      await expect(
        repository.updateProfile("user-1", {
          displayName: "Anna",
          email: null,
          username: "bob",
        }),
      ).rejects.toBeInstanceOf(UsernameTakenError);
    });

    it("rejects an email address that another user owns", async () => {
      const repository = await createRepository();

      await repository.updateProfile("user-2", {
        displayName: "Bob",
        email: "bob@example.invalid",
        username: "bob",
      });

      await expect(
        repository.updateProfile("user-1", {
          displayName: "Anna",
          email: "bob@example.invalid",
          username: "anna",
        }),
      ).rejects.toBeInstanceOf(EmailTakenError);
    });

    it("rethrows failures that are no uniqueness conflicts", async () => {
      const repository = new UserRepository(getDatabase());
      await getDatabase().close();

      await expect(
        repository.updateProfile("user-1", {
          displayName: "Anna",
          email: null,
          username: "anna",
        }),
      ).rejects.toBeInstanceOf(Error);
    });
  });

  describe("account changes", () => {
    it("persists the password-change requirement until replacing the password", async () => {
      const repository = new UserRepository(getDatabase());
      await repository.insert(createNewUser({ mustChangePassword: true }));

      await expect(repository.findById("user-1")).resolves.toMatchObject({
        mustChangePassword: true,
      });
      await expect(repository.findAll()).resolves.toEqual([
        expect.objectContaining({ mustChangePassword: true }),
      ]);
      await expect(
        repository.findCredentialsByUsername("anna"),
      ).resolves.toMatchObject({
        user: { mustChangePassword: true },
      });
      await repository.updatePasswordHash("user-1", "chosen-hash");
      await expect(
        repository.findCredentialsByUsername("anna"),
      ).resolves.toMatchObject({
        passwordHash: "chosen-hash",
        user: { mustChangePassword: false },
      });
    });
    it("replaces the avatar reference", async () => {
      const repository = await createRepository();

      await repository.updateAvatarReference("user-1", {
        avatarImageUrl: null,
        avatarType: USER_AVATAR_TYPE.ICON,
      });

      await expect(repository.findById("user-1")).resolves.toMatchObject({
        avatarImageUrl: null,
        avatarType: USER_AVATAR_TYPE.ICON,
      });
    });

    it("replaces the role", async () => {
      const repository = await createRepository();

      await repository.updateRole("user-1", ROLE.MANAGER);

      await expect(repository.findById("user-1")).resolves.toMatchObject({
        role: ROLE.MANAGER,
      });
    });
  });

  describe("avatar images", () => {
    it("returns null while no image is stored", async () => {
      const repository = await createRepository();

      await expect(repository.findAvatarByUserId("user-1")).resolves.toBe(null);
    });

    it("stores an image and replaces it on the next upload", async () => {
      const repository = await createRepository();

      await repository.upsertAvatar("user-1", {
        data: Buffer.from([1, 2, 3]),
        filename: "first.png",
        mimeType: "image/png",
      });
      await repository.upsertAvatar("user-1", {
        data: Buffer.from([9, 8]),
        filename: "second.webp",
        mimeType: "image/webp",
      });

      await expect(repository.findAvatarByUserId("user-1")).resolves.toEqual({
        data: Buffer.from([9, 8]),
        filename: "second.webp",
        mimeType: "image/webp",
      });
    });
  });
});
