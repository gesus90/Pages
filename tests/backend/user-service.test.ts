import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LastAdministratorError,
  RoleAssignmentDeniedError,
  UserManagementDeniedError,
  UserNotFoundError,
  UserService,
} from "@/backend/service/UserService";
import { ROLE } from "@/definition/Role";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { Role } from "@/definition/Role";
import type { User } from "@/definition/User";

function createUser(overrides: Partial<User> = {}): User {
  return {
    displayName: "Admin",
    id: "user-1",
    isActive: true,
    role: ROLE.ADMIN,
    username: "admin",
    ...overrides,
  };
}

function createRepository(): UserRepository & {
  countActiveAdministrators: ReturnType<typeof vi.fn>;
  findAll: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  findCredentialsByUsername: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  setActive: ReturnType<typeof vi.fn>;
} {
  return {
    countActiveAdministrators: vi.fn(),
    findAll: vi.fn(),
    findById: vi.fn(),
    findCredentialsByUsername: vi.fn(),
    hasUsers: vi.fn(),
    insert: vi.fn(),
    setActive: vi.fn(),
  } as unknown as UserRepository & {
    countActiveAdministrators: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findCredentialsByUsername: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    setActive: ReturnType<typeof vi.fn>;
  };
}

function createPermissions(): PermissionService & {
  canAssignRole: ReturnType<typeof vi.fn>;
  canManageUser: ReturnType<typeof vi.fn>;
  hasPermission: ReturnType<typeof vi.fn>;
} {
  return {
    canAssignRole: vi.fn().mockReturnValue(true),
    canManageUser: vi.fn().mockReturnValue(true),
    hasPermission: vi.fn().mockReturnValue(true),
  } as unknown as PermissionService & {
    canAssignRole: ReturnType<typeof vi.fn>;
    canManageUser: ReturnType<typeof vi.fn>;
    hasPermission: ReturnType<typeof vi.fn>;
  };
}

describe("UserService", () => {
  let repository: ReturnType<typeof createRepository>;
  let permissions: ReturnType<typeof createPermissions>;
  let service: UserService;

  beforeEach(() => {
    repository = createRepository();
    permissions = createPermissions();
    service = new UserService(repository, permissions);
  });

  it("returns the user found by the repository", async () => {
    const user = createUser();
    repository.findById.mockResolvedValue(user);

    await expect(service.getById("user-1")).resolves.toBe(user);
    expect(repository.findById).toHaveBeenCalledTimes(1);
    expect(repository.findById).toHaveBeenCalledWith("user-1");
  });

  it("returns null when the repository finds no user", async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.getById("missing")).resolves.toBeNull();
  });

  it("propagates repository failures when loading a user", async () => {
    repository.findById.mockRejectedValue(new Error("Database unavailable"));

    await expect(service.getById("user-1")).rejects.toThrow(
      "Database unavailable",
    );
  });

  it("returns every user for a permitted actor", async () => {
    const users = [createUser()];
    repository.findAll.mockResolvedValue(users);

    await expect(service.findAll(createUser())).resolves.toBe(users);
    expect(repository.findAll).toHaveBeenCalledTimes(1);
  });

  it("denies the user list to actors without viewing rights", async () => {
    permissions.hasPermission.mockReturnValue(false);

    await expect(service.findAll(createUser())).rejects.toThrow(
      UserManagementDeniedError,
    );
    expect(repository.findAll).not.toHaveBeenCalled();
  });

  it("returns credentials found by the repository", async () => {
    const credentials = {
      passwordHash: "encoded-hash",
      user: createUser(),
    };
    repository.findCredentialsByUsername.mockResolvedValue(credentials);

    await expect(service.findCredentialsByUsername("admin")).resolves.toBe(
      credentials,
    );
    expect(repository.findCredentialsByUsername).toHaveBeenCalledWith("admin");
  });

  it("returns null for unknown usernames", async () => {
    repository.findCredentialsByUsername.mockResolvedValue(null);

    await expect(
      service.findCredentialsByUsername("ghost"),
    ).resolves.toBeNull();
  });

  it("creates users for authorized actors", async () => {
    const input = {
      displayName: "Newcomer",
      id: "user-2",
      passwordHash: "encoded-hash",
      role: ROLE.EMPLOYEE as Role,
      username: "newcomer",
    };
    repository.insert.mockResolvedValue(undefined);

    await service.createUser(createUser(), input);

    expect(repository.insert).toHaveBeenCalledTimes(1);
    expect(repository.insert).toHaveBeenCalledWith(input);
  });

  it("denies user creation without management rights", async () => {
    permissions.hasPermission.mockReturnValue(false);

    await expect(
      service.createUser(createUser(), {
        displayName: "Newcomer",
        id: "user-2",
        passwordHash: "hash",
        role: ROLE.EMPLOYEE,
        username: "newcomer",
      }),
    ).rejects.toThrow(UserManagementDeniedError);
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("denies role assignments beyond the actor scope", async () => {
    permissions.canAssignRole.mockReturnValue(false);

    await expect(
      service.createUser(createUser(), {
        displayName: "Newcomer",
        id: "user-2",
        passwordHash: "hash",
        role: ROLE.ADMIN,
        username: "newcomer",
      }),
    ).rejects.toThrow(RoleAssignmentDeniedError);
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("propagates repository failures when creating a user", async () => {
    repository.insert.mockRejectedValue(new Error("Username taken"));

    await expect(
      service.createUser(createUser(), {
        displayName: "Newcomer",
        id: "user-2",
        passwordHash: "hash",
        role: ROLE.EMPLOYEE,
        username: "newcomer",
      }),
    ).rejects.toThrow("Username taken");
  });

  it("activates users for authorized actors", async () => {
    const target = createUser({
      id: "user-2",
      isActive: false,
      username: "newcomer",
    });
    repository.findById.mockResolvedValue(target);
    repository.setActive.mockResolvedValue(undefined);

    await service.setActive(createUser(), "user-2", true);

    expect(repository.setActive).toHaveBeenCalledWith("user-2", true);
  });

  it("deactivates employees without consulting administrators", async () => {
    const target = createUser({
      id: "user-2",
      role: ROLE.EMPLOYEE,
      username: "newcomer",
    });
    repository.findById.mockResolvedValue(target);
    repository.setActive.mockResolvedValue(undefined);

    await service.setActive(createUser(), "user-2", false);

    expect(repository.countActiveAdministrators).not.toHaveBeenCalled();
    expect(repository.setActive).toHaveBeenCalledWith("user-2", false);
  });

  it("deactivates administrators while others remain", async () => {
    const target = createUser({ id: "user-2", username: "second-admin" });
    repository.findById.mockResolvedValue(target);
    repository.countActiveAdministrators.mockResolvedValue(2);
    repository.setActive.mockResolvedValue(undefined);

    await service.setActive(createUser(), "user-2", false);

    expect(repository.setActive).toHaveBeenCalledWith("user-2", false);
  });

  it("protects the last active administrator", async () => {
    const target = createUser({ id: "user-1" });
    repository.findById.mockResolvedValue(target);
    repository.countActiveAdministrators.mockResolvedValue(1);

    await expect(
      service.setActive(createUser(), "user-1", false),
    ).rejects.toThrow(LastAdministratorError);
    expect(repository.setActive).not.toHaveBeenCalled();
  });

  it("denies activation changes without management rights", async () => {
    permissions.hasPermission.mockReturnValue(false);

    await expect(
      service.setActive(createUser(), "user-2", true),
    ).rejects.toThrow(UserManagementDeniedError);
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it("reports unknown users when changing their state", async () => {
    repository.findById.mockResolvedValue(null);

    await expect(
      service.setActive(createUser(), "missing", true),
    ).rejects.toThrow(UserNotFoundError);
    expect(repository.setActive).not.toHaveBeenCalled();
  });

  it("denies changes to users outside the actor scope", async () => {
    repository.findById.mockResolvedValue(createUser({ id: "user-2" }));
    permissions.canManageUser.mockReturnValue(false);

    await expect(
      service.setActive(createUser({ role: ROLE.MANAGER }), "user-2", false),
    ).rejects.toThrow(UserManagementDeniedError);
    expect(repository.setActive).not.toHaveBeenCalled();
  });
});
