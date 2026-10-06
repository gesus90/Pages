import { beforeEach, describe, expect, it } from "vitest";

import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { ROLE } from "@/definition/Role";

import { createDatabase } from "../helpers/factories";
import { UsernameTakenError } from "@/backend/error/UserErrors";

/** Avatar columns of a user row for an account that keeps its initials avatar. */
const AVATAR_COLUMNS = ["initials", null, null, null, 0] as const;

/** The user fields those avatar columns map to. */
const INITIALS_AVATAR = {
  mustChangePassword: false,
  avatarColor: null,
  avatarIcon: null,
  avatarImageUrl: null,
  avatarType: "initials",
} as const;

describe("UserRepository", () => {
  let database: ReturnType<typeof createDatabase>;
  let repository: UserRepository;

  beforeEach(() => {
    database = createDatabase();
    repository = new UserRepository(database);
  });

  it("returns the user for a known identifier", async () => {
    database.query.mockResolvedValue([
      ["user-1", "admin", "Admin", "admin", 1, ...AVATAR_COLUMNS],
    ]);

    await expect(repository.findById("user-1")).resolves.toEqual({
      ...INITIALS_AVATAR,
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
      ["user-2", "mueller", "Müller", "employee", 0, ...AVATAR_COLUMNS],
    ]);

    await expect(repository.findById("user-2")).resolves.toEqual({
      ...INITIALS_AVATAR,
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
      ["user-1", "admin", "Admin", "owner", 1, ...AVATAR_COLUMNS],
    ]);

    await expect(repository.findById("user-1")).rejects.toThrow(
      'Database returned an unsupported role "owner".',
    );
  });

  it("throws for rows with an unsupported avatar type", async () => {
    database.query.mockResolvedValue([
      ["user-1", "admin", "Admin", "admin", 1, "hologram", null, null, null],
    ]);

    await expect(repository.findById("user-1")).rejects.toThrow(
      'Database returned an unsupported avatar type "hologram".',
    );
  });

  it("throws for rows with a non-binary active flag", async () => {
    database.query.mockResolvedValue([
      ["user-1", "admin", "Admin", "admin", "yes", ...AVATAR_COLUMNS],
    ]);

    await expect(repository.findById("user-1")).rejects.toThrow(
      'Database returned an invalid value for "is_active".',
    );
  });

  it("returns every user ordered by display name", async () => {
    database.query.mockResolvedValue([
      ["user-1", "admin", "Admin", "admin", 1, ...AVATAR_COLUMNS],
      ["user-2", "mueller", "Müller", "employee", 0, ...AVATAR_COLUMNS],
    ]);

    const users = await repository.findAll();

    expect(users).toHaveLength(2);
    expect(users[0]).toEqual({
      ...INITIALS_AVATAR,
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
      [
        "user-1",
        "admin",
        "Admin",
        "admin",
        1,
        ...AVATAR_COLUMNS,
        "stored-hash",
      ],
    ]);

    await expect(
      repository.findCredentialsByUsername("admin"),
    ).resolves.toEqual({
      passwordHash: "stored-hash",
      user: {
        ...INITIALS_AVATAR,
        displayName: "Admin",
        id: "user-1",
        isActive: true,
        role: "admin",
        username: "admin",
      },
    });
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE lower(username) = lower($username)"),
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

    expect(database.execute).toHaveBeenCalledTimes(2);
    const [statement, parameters] = database.execute.mock.calls[0] as [
      string,
      Record<string, string>,
    ];

    expect(statement).toContain("INSERT INTO users");
    expect(parameters).toEqual({
      created_at: null,
      display_name: "Admin",
      email: null,
      id: "user-1",
      is_active: true,
      must_change_password: false,
      password_hash: "stored-hash",
      role: "admin",
      username: "admin",
    });
  });

  it("translates username conflicts into a UsernameTakenError", async () => {
    database.execute.mockRejectedValue(
      new Error(
        'Constraint Error: Duplicate key "username: admin" violates unique constraint.',
      ),
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

  it("translates case-insensitive username conflicts into a UsernameTakenError", async () => {
    database.execute.mockRejectedValue(
      new Error(
        'Constraint Error: Duplicate key "lower(username): admin" violates unique constraint.',
      ),
    );

    await expect(
      repository.insert({
        displayName: "Admin",
        id: "user-1",
        passwordHash: "hash",
        role: ROLE.ADMIN,
        username: "ADMIN",
      }),
    ).rejects.toBeInstanceOf(UsernameTakenError);
  });

  it("rethrows unrelated constraint violations", async () => {
    database.execute.mockRejectedValue(
      new Error(
        'Constraint Error: Duplicate key "email: a@example.invalid" violates unique constraint.',
      ),
    );

    await expect(
      repository.insert({
        displayName: "Admin",
        id: "user-1",
        passwordHash: "hash",
        role: ROLE.ADMIN,
        username: "admin",
      }),
    ).rejects.toThrow('Duplicate key "email: a@example.invalid"');
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
