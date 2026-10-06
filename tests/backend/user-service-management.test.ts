import { beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { UserService } from "@/backend/service/UserService";
import { ROLE } from "@/definition/Role";

import { createUser } from "../helpers/factories";
import {
  EmailTakenError,
  LastAdministratorError,
  RoleAssignmentDeniedError,
  UserManagementDeniedError,
  UserNotFoundError,
  UsernameTakenError,
} from "@/backend/error/UserErrors";

import type { PasswordHasher } from "@/backend/auth/PasswordHasher";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";

/** A user repository whose given methods are `vi.fn()` spies. */
type RepositoryDouble = UserRepository & {
  [Method in (typeof REPOSITORY_METHODS)[number]]: ReturnType<typeof vi.fn>;
};

const REPOSITORY_METHODS = [
  "countActiveAdministrators",
  "findAvatarByUserId",
  "findByEmail",
  "findById",
  "findCredentialsByUsername",
  "findEmailsByUserIds",
  "updateAvatarReference",
  "updatePasswordHash",
  "resetPasswordHash",
  "updateProfile",
  "updateRole",
  "upsertAvatar",
] as const;

function createRepository(): RepositoryDouble {
  return Object.fromEntries(
    REPOSITORY_METHODS.map((method) => [method, vi.fn()]),
  ) as unknown as RepositoryDouble;
}

const PROFILE = {
  displayName: "Admin",
  email: "admin@example.invalid",
  role: ROLE.ADMIN,
  username: "admin",
} as const;

describe("UserService profile and role management", () => {
  let permissions: PermissionService;
  let repository: RepositoryDouble;
  let service: UserService;
  const admin = createUser();
  const manager = createUser({ id: "user-2", role: ROLE.MANAGER });
  const employee = createUser({ id: "user-3", role: ROLE.EMPLOYEE });

  beforeEach(() => {
    repository = createRepository();
    permissions = new PermissionService();
    service = new UserService(repository, permissions);
  });

  describe("email lookups", () => {
    it("returns the addresses of several users to permitted actors", async () => {
      const emails = new Map([["user-1", "admin@example.invalid"]]);
      repository.findEmailsByUserIds.mockResolvedValue(emails);

      await expect(service.findEmailAddresses(admin, ["user-1"])).resolves.toBe(
        emails,
      );
      expect(repository.findEmailsByUserIds).toHaveBeenCalledWith(["user-1"]);
    });

    it("denies address lookups to actors who may not view users", async () => {
      await expect(
        service.findEmailAddresses(employee, ["user-1"]),
      ).rejects.toBeInstanceOf(UserManagementDeniedError);
      expect(repository.findEmailsByUserIds).not.toHaveBeenCalled();
    });

    it("returns the own address or null", async () => {
      repository.findEmailsByUserIds
        .mockResolvedValueOnce(new Map([["user-1", "admin@example.invalid"]]))
        .mockResolvedValueOnce(new Map());

      await expect(service.findProfileEmail("user-1")).resolves.toBe(
        "admin@example.invalid",
      );
      await expect(service.findProfileEmail("user-1")).resolves.toBeNull();
    });
  });

  describe("updateOwnProfile", () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(admin);
      repository.findByEmail.mockResolvedValue(null);
      repository.findCredentialsByUsername.mockResolvedValue(null);
      repository.countActiveAdministrators.mockResolvedValue(2);
    });

    it("lets administrators change their own profile", async () => {
      await service.updateOwnProfile(admin, {
        ...PROFILE,
        displayName: "Root",
      });

      expect(repository.updateProfile).toHaveBeenCalledWith("user-1", {
        ...PROFILE,
        displayName: "Root",
      });
      expect(repository.updateRole).not.toHaveBeenCalled();
    });

    it("denies profile edits to everyone but administrators", async () => {
      await expect(
        service.updateOwnProfile(manager, PROFILE),
      ).rejects.toBeInstanceOf(UserManagementDeniedError);
      expect(repository.updateProfile).not.toHaveBeenCalled();
    });

    it("reports an actor who no longer exists", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.updateOwnProfile(admin, PROFILE),
      ).rejects.toBeInstanceOf(UserNotFoundError);
    });

    it("rejects a username that belongs to someone else", async () => {
      repository.findCredentialsByUsername.mockResolvedValue({
        passwordHash: "hash",
        user: createUser({ id: "user-9", username: "taken" }),
      });

      await expect(
        service.updateOwnProfile(admin, { ...PROFILE, username: "taken" }),
      ).rejects.toBeInstanceOf(UsernameTakenError);
    });

    it("rejects an email address that belongs to someone else", async () => {
      repository.findByEmail.mockResolvedValue(createUser({ id: "user-9" }));

      await expect(
        service.updateOwnProfile(admin, PROFILE),
      ).rejects.toBeInstanceOf(EmailTakenError);
    });

    it("does not check the username when it stays the same", async () => {
      await service.updateOwnProfile(admin, PROFILE);

      expect(repository.findCredentialsByUsername).not.toHaveBeenCalled();
    });

    it("protects the last active administrator from demoting themselves", async () => {
      repository.countActiveAdministrators.mockResolvedValue(1);

      await expect(
        service.updateOwnProfile(admin, { ...PROFILE, role: ROLE.MANAGER }),
      ).rejects.toBeInstanceOf(LastAdministratorError);
      expect(repository.updateRole).not.toHaveBeenCalled();
    });

    it("changes the role while other administrators remain", async () => {
      await service.updateOwnProfile(admin, { ...PROFILE, role: ROLE.MANAGER });

      expect(repository.updateRole).toHaveBeenCalledWith("user-1", "manager");
    });

    it("denies roles the actor may not assign", async () => {
      vi.spyOn(permissions, "canAssignRole").mockReturnValue(false);

      await expect(
        service.updateOwnProfile(admin, { ...PROFILE, role: ROLE.MANAGER }),
      ).rejects.toBeInstanceOf(RoleAssignmentDeniedError);
      expect(repository.updateRole).not.toHaveBeenCalled();
    });

    it("ignores the administrator count for an inactive administrator", async () => {
      repository.findById.mockResolvedValue({ ...admin, isActive: false });
      repository.countActiveAdministrators.mockResolvedValue(1);

      await service.updateOwnProfile(admin, { ...PROFILE, role: ROLE.MANAGER });

      expect(repository.countActiveAdministrators).not.toHaveBeenCalled();
      expect(repository.updateRole).toHaveBeenCalledWith("user-1", "manager");
    });

    it("ignores the administrator count when the stored role is no administrator", async () => {
      repository.findById.mockResolvedValue({ ...admin, role: ROLE.MANAGER });

      await service.updateOwnProfile(admin, { ...PROFILE, role: ROLE.ADMIN });

      expect(repository.countActiveAdministrators).not.toHaveBeenCalled();
      expect(repository.updateRole).toHaveBeenCalledWith("user-1", "admin");
    });

    it("accepts a username that only differs by letter case from the own one", async () => {
      repository.findCredentialsByUsername.mockResolvedValue({
        passwordHash: "hash",
        user: admin,
      });

      await service.updateOwnProfile(admin, { ...PROFILE, username: "Admin" });

      expect(repository.updateProfile).toHaveBeenCalledTimes(1);
    });

    it("accepts a profile without an email address", async () => {
      await service.updateOwnProfile(admin, { ...PROFILE, email: null });

      expect(repository.findByEmail).not.toHaveBeenCalled();
      expect(repository.updateProfile).toHaveBeenCalledTimes(1);
    });

    it("accepts an email address that already belongs to the actor", async () => {
      repository.findByEmail.mockResolvedValue(admin);

      await service.updateOwnProfile(admin, PROFILE);

      expect(repository.updateProfile).toHaveBeenCalledTimes(1);
    });
  });

  describe("avatars", () => {
    const avatar = {
      data: Buffer.from([1, 2, 3]),
      filename: "me.png",
      mimeType: "image/png",
    };

    it("stores a new image and points the user to it", async () => {
      await service.updateOwnAvatar("user-1", {
        ...avatar,
        avatarImageUrl: "/users/user-1/avatar?v=1",
        avatarType: "image",
      });

      expect(repository.upsertAvatar).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ mimeType: "image/png" }),
      );
      expect(repository.updateAvatarReference).toHaveBeenCalledWith("user-1", {
        avatarImageUrl: "/users/user-1/avatar?v=1",
        avatarType: "image",
      });
    });

    it("replaces and reads the stored image", async () => {
      repository.findAvatarByUserId.mockResolvedValue(avatar);

      await service.replaceAvatar("user-1", avatar);

      expect(repository.upsertAvatar).toHaveBeenCalledWith("user-1", avatar);
      await expect(service.getAvatar("user-1")).resolves.toBe(avatar);
    });
  });

  it("stores a new password hash without permission checks", async () => {
    await service.updatePasswordHash("user-1", "new-hash");

    expect(repository.updatePasswordHash).toHaveBeenCalledWith(
      "user-1",
      "new-hash",
    );
  });

  describe("updateUser", () => {
    const profile = {
      displayName: "Sam",
      email: "sam@example.invalid",
      username: "sam",
    };

    beforeEach(() => {
      repository.findById.mockResolvedValue(employee);
      repository.findByEmail.mockResolvedValue(null);
    });

    it("updates users inside the actor scope", async () => {
      await service.updateUser(manager, "user-3", profile);

      expect(repository.updateProfile).toHaveBeenCalledWith("user-3", profile);
    });

    it("denies actors without management rights", async () => {
      await expect(
        service.updateUser(employee, "user-3", profile),
      ).rejects.toBeInstanceOf(UserManagementDeniedError);
    });

    it("reports unknown users", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.updateUser(admin, "missing", profile),
      ).rejects.toBeInstanceOf(UserNotFoundError);
    });

    it("denies users outside the actor scope", async () => {
      repository.findById.mockResolvedValue(admin);

      await expect(
        service.updateUser(manager, "user-1", profile),
      ).rejects.toBeInstanceOf(UserManagementDeniedError);
    });

    it("rejects an email address used by another user", async () => {
      repository.findByEmail.mockResolvedValue(createUser({ id: "user-9" }));

      await expect(
        service.updateUser(admin, "user-3", profile),
      ).rejects.toBeInstanceOf(EmailTakenError);
    });

    it("allows the unchanged email address of the same user", async () => {
      repository.findByEmail.mockResolvedValue(employee);

      await service.updateUser(admin, "user-3", profile);

      expect(repository.updateProfile).toHaveBeenCalledTimes(1);
    });

    it("accepts a profile without email", async () => {
      await service.updateUser(admin, "user-3", { ...profile, email: null });

      expect(repository.findByEmail).not.toHaveBeenCalled();
    });
  });

  describe("setRole", () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(employee);
      repository.countActiveAdministrators.mockResolvedValue(2);
    });

    it("assigns roles inside the actor scope", async () => {
      await service.setRole(admin, "user-3", ROLE.MANAGER);

      expect(repository.updateRole).toHaveBeenCalledWith("user-3", "manager");
    });

    it("denies actors without management rights", async () => {
      await expect(
        service.setRole(employee, "user-3", ROLE.MANAGER),
      ).rejects.toBeInstanceOf(UserManagementDeniedError);
    });

    it("reports unknown users", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.setRole(admin, "missing", ROLE.MANAGER),
      ).rejects.toBeInstanceOf(UserNotFoundError);
    });

    it("denies users outside the actor scope", async () => {
      repository.findById.mockResolvedValue(admin);

      await expect(
        service.setRole(manager, "user-1", ROLE.EMPLOYEE),
      ).rejects.toBeInstanceOf(UserManagementDeniedError);
    });

    it("denies roles beyond the actor scope", async () => {
      await expect(
        service.setRole(manager, "user-3", ROLE.ADMIN),
      ).rejects.toBeInstanceOf(RoleAssignmentDeniedError);
    });

    it("protects the last active administrator from demotion", async () => {
      repository.findById.mockResolvedValue(admin);
      repository.countActiveAdministrators.mockResolvedValue(1);

      await expect(
        service.setRole(admin, "user-1", ROLE.EMPLOYEE),
      ).rejects.toBeInstanceOf(LastAdministratorError);
    });

    it("demotes an administrator while others remain", async () => {
      repository.findById.mockResolvedValue(admin);

      await service.setRole(admin, "user-1", ROLE.EMPLOYEE);

      expect(repository.updateRole).toHaveBeenCalledWith("user-1", "employee");
    });

    it("ignores the administrator count for inactive administrators", async () => {
      repository.findById.mockResolvedValue(
        createUser({ id: "user-4", isActive: false }),
      );
      repository.countActiveAdministrators.mockResolvedValue(1);

      await service.setRole(admin, "user-4", ROLE.EMPLOYEE);

      expect(repository.updateRole).toHaveBeenCalledTimes(1);
    });
  });

  describe("resetPassword", () => {
    const hasher = { hash: vi.fn() } as unknown as PasswordHasher & {
      hash: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      hasher.hash.mockReset();
      hasher.hash.mockImplementation((password: string) =>
        Promise.resolve(`hash-of-${password}`),
      );
      repository.findById.mockResolvedValue(employee);
    });

    it("stores only the hash of a generated temporary password", async () => {
      const result = await service.resetPassword(admin, "user-3", hasher);

      expect(result.temporaryPassword).toMatch(
        /^[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}$/u,
      );
      expect(repository.resetPasswordHash).toHaveBeenCalledWith(
        "user-3",
        `hash-of-${result.temporaryPassword}`,
      );
    });

    it("generates a different password each time", async () => {
      const first = await service.resetPassword(admin, "user-3", hasher);
      const second = await service.resetPassword(admin, "user-3", hasher);

      expect(first.temporaryPassword).not.toBe(second.temporaryPassword);
    });

    it("denies actors without management rights", async () => {
      await expect(
        service.resetPassword(employee, "user-3", hasher),
      ).rejects.toBeInstanceOf(UserManagementDeniedError);
      expect(hasher.hash).not.toHaveBeenCalled();
    });

    it("reports unknown users", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.resetPassword(admin, "missing", hasher),
      ).rejects.toBeInstanceOf(UserNotFoundError);
    });

    it("denies users outside the actor scope", async () => {
      repository.findById.mockResolvedValue(admin);

      await expect(
        service.resetPassword(manager, "user-1", hasher),
      ).rejects.toBeInstanceOf(UserManagementDeniedError);
    });
  });

  it("rejects creating users with an email address already in use", async () => {
    repository.findByEmail.mockResolvedValue(createUser({ id: "user-9" }));

    await expect(
      service.createUser(admin, {
        displayName: "New",
        email: "taken@example.invalid",
        id: "user-10",
        passwordHash: "hash",
        role: ROLE.EMPLOYEE,
        username: "new",
      }),
    ).rejects.toBeInstanceOf(EmailTakenError);
  });
});
