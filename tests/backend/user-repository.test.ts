import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { ROLE } from "@/definition/Role";

import type { Database } from "@/backend/database/Database";

function createDatabase(): Database & {
  execute: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
} {
  return {
    close: vi.fn(),
    execute: vi.fn(),
    migrate: vi.fn(),
    query: vi.fn(),
  } as unknown as Database & {
    execute: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };
}

describe("UserRepository", () => {
  let database: ReturnType<typeof createDatabase>;
  let repository: UserRepository;

  beforeEach(() => {
    database = createDatabase();
    repository = new UserRepository(database);
  });

  it("reports whether users exist", async () => {
    database.query.mockResolvedValue([[1n]]);

    await expect(repository.hasUsers()).resolves.toBe(true);
    expect(database.query).toHaveBeenCalledTimes(1);

    database.query.mockResolvedValue([[0n]]);

    await expect(repository.hasUsers()).resolves.toBe(false);
  });

  it("supports numeric counts returned as numbers", async () => {
    database.query.mockResolvedValue([[3]]);

    await expect(repository.hasUsers()).resolves.toBe(true);
  });

  it("throws when the user count row is missing", async () => {
    database.query.mockResolvedValue([]);

    await expect(repository.hasUsers()).rejects.toThrow(
      "Database returned no user count.",
    );
  });

  it("returns the user for a known identifier", async () => {
    database.query.mockResolvedValue([["user-1", "admin", "Admin"]]);

    await expect(repository.findById("user-1")).resolves.toEqual({
      displayName: "Admin",
      id: "user-1",
      username: "admin",
    });
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("FROM users"),
      { id: "user-1" },
    );
  });

  it("returns null for unknown identifiers", async () => {
    database.query.mockResolvedValue([]);

    await expect(repository.findById("missing")).resolves.toBeNull();
  });

  it("returns credentials for a known username", async () => {
    database.query.mockResolvedValue([
      ["user-1", "admin", "Admin", "stored-hash"],
    ]);

    await expect(
      repository.findCredentialsByUsername("admin"),
    ).resolves.toEqual({
      passwordHash: "stored-hash",
      user: { displayName: "Admin", id: "user-1", username: "admin" },
    });
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE username"),
      { username: "admin" },
    );
  });

  it("returns null for unknown usernames", async () => {
    database.query.mockResolvedValue([]);

    await expect(
      repository.findCredentialsByUsername("ghost"),
    ).resolves.toBeNull();
  });

  it("inserts a user with explicit columns", async () => {
    database.execute.mockResolvedValue(undefined);

    await repository.insert({
      displayName: "Admin",
      id: "user-1",
      passwordHash: "stored-hash",
      role: ROLE.ADMIN,
      username: "admin",
    });

    expect(database.execute).toHaveBeenCalledTimes(1);
    const [statement, parameters] = database.execute.mock.calls[0] as [
      string,
      Record<string, string>,
    ];

    expect(statement).toContain("INSERT INTO users");
    expect(parameters).toEqual({
      display_name: "Admin",
      id: "user-1",
      password_hash: "stored-hash",
      role: "admin",
      username: "admin",
    });
  });

  it("propagates database failures", async () => {
    database.query.mockRejectedValue(new Error("Query failed"));

    await expect(repository.hasUsers()).rejects.toThrow("Query failed");
    await expect(repository.findById("user-1")).rejects.toThrow("Query failed");

    database.execute.mockRejectedValue(new Error("Insert failed"));

    await expect(
      repository.insert({
        displayName: "Admin",
        id: "user-1",
        passwordHash: "hash",
        role: ROLE.ADMIN,
        username: "admin",
      }),
    ).rejects.toThrow("Insert failed");
  });
});
