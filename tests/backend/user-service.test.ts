import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserService } from "@/backend/service/UserService";
import { ROLE } from "@/definition/Role";

import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { User } from "@/definition/User";

function createUserRepository(): UserRepository & {
  findById: ReturnType<typeof vi.fn>;
  findCredentialsByUsername: ReturnType<typeof vi.fn>;
  hasUsers: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
} {
  return {
    findById: vi.fn(),
    findCredentialsByUsername: vi.fn(),
    hasUsers: vi.fn(),
    insert: vi.fn(),
  } as unknown as UserRepository & {
    findById: ReturnType<typeof vi.fn>;
    findCredentialsByUsername: ReturnType<typeof vi.fn>;
    hasUsers: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
  };
}

describe("UserService", () => {
  let repository: ReturnType<typeof createUserRepository>;
  let service: UserService;

  beforeEach(() => {
    repository = createUserRepository();
    service = new UserService(repository);
  });

  it("returns the user found by the repository", async () => {
    const user: User = {
      displayName: "Admin",
      id: "user-1",
      username: "admin",
    };
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

  it("returns credentials found by the repository", async () => {
    const credentials = {
      passwordHash: "encoded-hash",
      user: { displayName: "Admin", id: "user-1", username: "admin" },
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

  it("forwards new users to the repository", async () => {
    const input = {
      displayName: "Admin",
      id: "user-1",
      passwordHash: "encoded-hash",
      role: ROLE.ADMIN,
      username: "admin",
    };
    repository.insert.mockResolvedValue(undefined);

    await service.createUser(input);

    expect(repository.insert).toHaveBeenCalledTimes(1);
    expect(repository.insert).toHaveBeenCalledWith(input);
  });

  it("propagates repository failures when creating a user", async () => {
    repository.insert.mockRejectedValue(new Error("Username taken"));

    await expect(
      service.createUser({
        displayName: "Admin",
        id: "user-1",
        passwordHash: "hash",
        role: ROLE.ADMIN,
        username: "admin",
      }),
    ).rejects.toThrow("Username taken");
  });
});
