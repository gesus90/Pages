import { describe, expect, it } from "vitest";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { createAccess, createRole } from "../helpers/authorization";
import { useMigratedDatabase } from "../helpers/test-database";
import { createDatabase } from "../helpers/factories";

describe("AuthorizationRepository", () => {
  const getDatabase = useMigratedDatabase();

  it("does not restore permissions of a customized compatibility profile", async () => {
    const repository = new AuthorizationRepository(getDatabase());
    const input = {
      username: "one",
      id: "one",
      displayName: "One",
      passwordHash: "hash",
      role: "employee" as const,
    };
    await repository.users().insert(input);
    await repository.saveRole(
      createRole({
        id: "legacy-employee",
        name: "Employee",
        rank: 10,
        permissions: [],
      }),
    );
    await repository.users().insert({ ...input, id: "two", username: "two" });
    expect((await repository.snapshot()).roles[0]?.permissions).toEqual([]);
  });

  it("stores shared roles, department labels and independent memberships", async () => {
    const repository = new AuthorizationRepository(getDatabase());
    await repository.transaction(async (scope) => {
      await scope.users().insert({
        id: "actor",
        username: "actor",
        displayName: "Name",
        role: "manager",
        passwordHash: "hash",
        authorization: {
          roleId: "role",
          isAdmin: false,
          mode: "role",
          firstName: "Name",
          lastName: "",
        },
      });
      await scope.saveRole(createRole());
      await scope.saveDepartment({ id: "frontend", name: "Frontend" });
      await scope.saveDepartment({ id: "backend", name: "Backend" });
      await scope.saveAccount(createAccess());
      // Exercises nested repository transactions without releasing the outer lock.
      await scope.users().setActive("actor", false);
      await scope.users().setActive("actor", true);
    });
    const snapshot = await repository.snapshot();
    expect(snapshot.roles).toEqual([
      createRole({
        permissions: expect.arrayContaining([...createRole().permissions]),
      }),
    ]);
    expect(snapshot.accounts).toEqual([
      createAccess({
        role: createRole({
          permissions: expect.arrayContaining([...createRole().permissions]),
        }),
      }),
    ]);
    expect(snapshot.departments).toHaveLength(2);
    await repository.transaction(async (scope) => {
      await scope.deleteDepartment("frontend");
      await scope.saveAccount(
        createAccess({
          departments: [],
          managedDepartments: [],
          hasHadDepartment: false,
        }),
      );
      await scope.saveRole(createRole({ name: "Changed", permissions: [] }));
    });
    const changed = await repository.snapshot();
    expect(changed.accounts[0]).toMatchObject({
      hasHadDepartment: true,
      departments: [],
      managedDepartments: [],
    });
    expect(changed.roles[0]).toMatchObject({
      name: "Changed",
      permissions: [],
    });
    await repository.transaction(async (scope) => {
      await scope.saveAccount(
        createAccess({
          role: null,
          isAdmin: true,
          mode: "admin",
          departments: [],
          managedDepartments: [],
        }),
      );
      await scope.deleteRole("role");
    });
    expect((await repository.snapshot()).roles).toEqual([]);
    expect((await repository.snapshot()).accounts[0]?.role).toBeNull();
  });

  it("rolls back all writes if an aggregate operation fails", async () => {
    const repository = new AuthorizationRepository(getDatabase());
    await expect(
      repository.transaction(async (scope) => {
        await scope.saveDepartment({ id: "a", name: "HR" });
        await scope.saveDepartment({ id: "b", name: "hr" });
      }),
    ).rejects.toThrow();
    expect((await repository.snapshot()).departments).toEqual([]);
  });

  it.each(["missing-role", null])(
    "rejects corrupt account authorization: %s",
    async (roleId) => {
      const database = createDatabase();
      database.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          ["u", roleId, 1, "invalid", "", "", 1, 0, 0, 0],
        ]);
      await expect(
        new AuthorizationRepository(database).snapshot(),
      ).rejects.toThrow("Invalid account authorization reference");
    },
  );

  it("rejects unknown stored permissions", async () => {
    const database = createDatabase();
    database.query
      .mockResolvedValueOnce([["r", "Role", 1, 1]])
      .mockResolvedValueOnce([["r", "unknown"]]);
    await expect(
      new AuthorizationRepository(database).snapshot(),
    ).rejects.toThrow("Invalid stored capability");
  });
});
