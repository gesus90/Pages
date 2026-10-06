import { describe, expect, it } from "vitest";

import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { AdministrationService } from "@/backend/service/AdministrationService";
import { UserService } from "@/backend/service/UserService";
import { CAPABILITY } from "@/definition/Authorization";
import { createAccess, createRole } from "../helpers/authorization";
import { createUser } from "../helpers/factories";
import { useMigratedDatabase } from "../helpers/test-database";

describe("runtime compatibility user facade", () => {
  const getDatabase = useMigratedDatabase();
  async function setup(): Promise<{
    users: UserService;
    administration: AdministrationService;
    repository: AuthorizationRepository;
    hasher: PasswordHasher;
  }> {
    const repository = new AuthorizationRepository(getDatabase());
    const hasher = new PasswordHasher();
    const administration = new AdministrationService(
      repository,
      new ServerCache(),
      hasher,
    );
    const permissions = new PermissionService((id) =>
      administration.getContext(id),
    );
    const users = new UserService(
      repository.users(),
      permissions,
      administration,
    );
    await repository.users().insert({
      id: "admin",
      username: "admin",
      displayName: "Admin",
      role: "admin",
      passwordHash: "hash",
    });
    await administration.saveRole(
      "admin",
      createRole({
        id: "manager",
        permissions: [CAPABILITY.MANAGE_ROLES, CAPABILITY.MANAGE_USERS],
      }),
    );
    await administration.saveRole(
      "admin",
      createRole({ id: "reader", name: "Reader", rank: 1, permissions: [] }),
    );
    await administration.saveDepartment("admin", {
      id: "frontend",
      name: "Frontend",
    });
    await administration.saveDepartment("admin", { id: "hr", name: "HR" });
    for (const id of ["manager", "target", "outside"]) {
      const roleId = id === "manager" ? "manager" : "reader";
      await repository.users().insert({
        id,
        username: id,
        displayName: id,
        role: "employee",
        passwordHash: "hash",
        email: `${id}@test.invalid`,
        authorization: {
          roleId,
          isAdmin: false,
          mode: "role",
          firstName: id,
          lastName: "",
        },
      });
      await repository.saveAccount(
        createAccess({
          userId: id,
          role: createRole({ id: roleId }),
          departments: [id === "outside" ? "hr" : "frontend"],
        }),
      );
    }
    return { users, administration, repository, hasher };
  }

  it("filters the old list and address APIs with the same current scope as A2", async () => {
    const { users } = await setup();
    const actor = createUser({ id: "manager", role: "admin" });
    const visible = await users.findAll(actor);
    expect(visible.map((user) => user.id).sort()).toEqual([
      "admin",
      "manager",
      "target",
    ]);
    expect(visible[0]).not.toHaveProperty("email");
    expect(visible[0]).not.toHaveProperty("account");
    expect(
      await users.findEmailAddresses(actor, ["target", "outside"]),
    ).toEqual(new Map([["target", "target@test.invalid"]]));
  });

  it("routes supported mutations through current target checks and rejects fixed-role writes", async () => {
    const { users, repository, hasher } = await setup();
    const actor = createUser({ id: "manager", role: "admin" });
    await users.updateUser(actor, "target", {
      username: "renamed",
      displayName: "Target Updated",
      email: null,
    });
    expect(await repository.users().findById("target")).toMatchObject({
      displayName: "Target Updated",
    });
    await expect(
      users.updateUser(actor, "outside", {
        username: "outside",
        displayName: "No",
        email: null,
      }),
    ).rejects.toThrow("forbidden");
    expect(
      (await users.resetPassword(actor, "target", hasher)).temporaryPassword,
    ).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
    await users.setActive(actor, "target", false);
    expect((await repository.users().findById("target"))?.isActive).toBe(false);
    await expect(users.setActive(actor, "outside", false)).rejects.toThrow(
      "forbidden",
    );
    await expect(
      users.createUser(actor, {
        id: "injected",
        username: "injected",
        displayName: "Injected",
        passwordHash: "hash",
        role: "admin",
      }),
    ).rejects.toThrow();
    await expect(users.setRole(actor, "target", "admin")).rejects.toThrow();
    await expect(
      users.updateOwnProfile(actor, {
        username: "manager",
        displayName: "Manager",
        email: null,
        role: "admin",
      }),
    ).rejects.toThrow("forbidden");
    await users.updateOwnProfile(createUser({ id: "admin" }), {
      username: "admin",
      displayName: "Renamed Admin",
      email: null,
      role: "employee",
    });
    expect(
      (await repository.snapshot()).accounts.find(
        (account) => account.userId === "admin",
      ),
    ).toMatchObject({ isAdmin: true, role: null });
  });
});
