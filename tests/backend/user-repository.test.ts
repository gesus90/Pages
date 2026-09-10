import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  UsernameTakenError,
  UserRepository,
} from "@/backend/database/repositories/UserRepository";
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
    database.query.mockResolvedValue([
      ["user-1", "admin", "Admin", "admin", 1],
    ]);

    await expect(repository.findById("user-1")).resolves.toEqual({
      displayName: "Admin",
      id: "user-1",
      isActive: true,
      role: "admin",
      username: "admin",
    });
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("FROM users"),
      { id: "user-1" },
    );
  });

  it("returns inactive users with their flag", async () => {
    database.query.mockResolvedValue([
      ["user-2", "mueller", "Müller", "employee", 0],
    ]);

    await expect(repository.findById("user-2")).resolves.toEqual({
      displayName: "Müller",
      id: "user-2",
      isActive: false,
      role: "employee",
      username: "mueller",
    });
  });

  it("returns null for unknown identifiers", async () => {
    database.query.mockResolvedValue([]);

    await expect(repository.findById("missing")).resolves.toBeNull();
  });

  it("throws for rows with an unsupported role", async () => {
    database.query.mockResolvedValue([
      ["user-1", "admin", "Admin", "owner", 1],
    ]);

    await expect(repository.findById("user-1")).rejects.toThrow(
      'Database returned an unsupported role "owner".',
    );
  });

  it("throws for rows with a non-binary active flag", async () => {
    database.query.mockResolvedValue([
      ["user-1", "admin", "Admin", "admin", "yes"],
    ]);

    await expect(repository.findById("user-1")).rejects.toThrow(
      'Database returned an invalid value for "is_active".',
    );
  });

  it("returns every user ordered by display name", async () => {
    database.query.mockResolvedValue([
      ["user-1", "admin", "Admin", "admin", 1],
      ["user-2", "mueller", "Müller", "employee", 0],
    ]);

    const users = await repository.findAll();

    expect(users).toHaveLength(2);
    expect(users[0]).toEqual({
      displayName: "Admin",
      id: "user-1",
      isActive: true,
      role: "admin",
      username: "admin",
    });
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY display_name"),
    );
  });

  it("returns credentials for a known username", async () => {
    database.query.mockResolvedValue([
      ["user-1", "admin", "Admin", "admin", 1, "stored-hash"],
    ]);

    await expect(
      repository.findCredentialsByUsername("admin"),
    ).resolves.toEqual({
      passwordHash: "stored-hash",
      user: {
        displayName: "Admin",
        id: "user-1",
        isActive: true,
        role: "admin",
        username: "admin",
      },
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

  it("translates username conflicts into a UsernameTakenError", async () => {
    database.execute.mockRejectedValue(
      new Error("UNIQUE constraint failed: users.username"),
    );

    const failure = await repository
      .insert({
        displayName: "Admin",
        id: "user-1",
        passwordHash: "hash",
        role: ROLE.ADMIN,
        username: "admin",
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UsernameTakenError);
    expect((failure as Error).message).toContain("admin");
  });

  it("rethrows unrelated constraint violations", async () => {
    database.execute.mockRejectedValue(
      new Error("UNIQUE constraint failed: users.email"),
    );

    await expect(
      repository.insert({
        displayName: "Admin",
        id: "user-1",
        passwordHash: "hash",
        role: ROLE.ADMIN,
        username: "admin",
      }),
    ).rejects.toThrow("UNIQUE constraint failed: users.email");
  });

  it("rethrows non-error rejections while inserting", async () => {
    database.execute.mockRejectedValue("connection lost");

    await expect(
      repository.insert({
        displayName: "Admin",
        id: "user-1",
        passwordHash: "hash",
        role: ROLE.ADMIN,
        username: "admin",
      }),
    ).rejects.toBe("connection lost");
  });

  it("activates and deactivates users", async () => {
    database.execute.mockResolvedValue(undefined);

    await repository.setActive("user-1", false);

    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("is_active = $is_active"),
      { id: "user-1", is_active: false },
    );

    await repository.setActive("user-1", true);

    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("is_active = $is_active"),
      { id: "user-1", is_active: true },
    );
  });

  it("replaces stored password hashes", async () => {
    database.execute.mockResolvedValue(undefined);

    await repository.updatePasswordHash("user-1", "new-hash");

    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("password_hash = $password_hash"),
      { id: "user-1", password_hash: "new-hash" },
    );
  });

  it("counts active administrators", async () => {
    database.query.mockResolvedValue([[2n]]);

    await expect(repository.countActiveAdministrators()).resolves.toBe(2);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("is_active = 1"),
    );
  });

  it("throws when the administrator count row is missing", async () => {
    database.query.mockResolvedValue([]);

    await expect(repository.countActiveAdministrators()).rejects.toThrow(
      "Database returned no administrator count.",
    );
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
