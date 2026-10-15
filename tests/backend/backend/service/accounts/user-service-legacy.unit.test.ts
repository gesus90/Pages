import { describe, expect, it, vi } from "vitest";

import {
  EmailTakenError,
  LastAdministratorError,
  RoleAssignmentDeniedError,
  UserManagementDeniedError,
  UserNotFoundError,
  UsernameTakenError,
} from "@/backend/error/UserErrors";

import { UserServiceWorld } from "./user-service-world";

import type { User } from "@/definition/User";

const TEMPORARY_PASSWORD = /^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){2}$/u;

interface Directory {
  readonly world: UserServiceWorld;
  readonly admin: User;
  readonly manager: User;
  readonly employee: User;
}

/** One administrator, one manager and one employee of the fixed roles. */
function directory(): Directory {
  const world = new UserServiceWorld();
  world.accounts.addAdministrator({
    userId: "admin",
    legacyRole: "admin",
    email: "admin@example.test",
  });
  world.accounts.addAccount({
    userId: "manager",
    legacyRole: "manager",
    email: "manager@example.test",
  });
  world.accounts.addAccount({
    userId: "employee",
    legacyRole: "employee",
    email: "employee@example.test",
  });

  return {
    world,
    admin: world.accounts.user("admin"),
    manager: world.accounts.user("manager"),
    employee: world.accounts.user("employee"),
  };
}

describe("reading users", () => {
  it("returns a user by identifier or null", async () => {
    const { world } = directory();
    const service = world.legacyService();

    await expect(service.getById("manager")).resolves.toMatchObject({
      id: "manager",
    });
    await expect(service.getById("ghost")).resolves.toBeNull();
  });

  it("lists every user for administrators and managers", async () => {
    const { world, admin, manager } = directory();
    const service = world.legacyService();

    await expect(service.findAll(admin)).resolves.toHaveLength(3);
    await expect(service.findAll(manager)).resolves.toHaveLength(3);
  });

  it("refuses the list and the addresses to an employee", async () => {
    const { world, employee } = directory();
    const service = world.legacyService();

    await expect(service.findAll(employee)).rejects.toBeInstanceOf(
      UserManagementDeniedError,
    );
    await expect(
      service.findEmailAddresses(employee, ["admin"]),
    ).rejects.toBeInstanceOf(UserManagementDeniedError);
  });

  it("returns the requested addresses to a manager", async () => {
    const { world, manager } = directory();

    const emails = await world
      .legacyService()
      .findEmailAddresses(manager, ["employee", "ghost"]);

    expect([...emails]).toEqual([["employee", "employee@example.test"]]);
  });

  it("reads the own address without a permission check", async () => {
    const { world } = directory();
    const service = world.legacyService();

    await expect(service.findProfileEmail("employee")).resolves.toBe(
      "employee@example.test",
    );
    await expect(service.findProfileEmail("ghost")).resolves.toBeNull();
  });
});

describe("updateOwnProfile", () => {
  const profile = {
    displayName: "Ada Admin",
    username: "ada",
    email: "ada@example.test",
    role: "admin",
  } as const;

  it("lets an administrator change the own profile", async () => {
    const { world, admin } = directory();

    await world.legacyService().updateOwnProfile(admin, profile);

    expect(world.accounts.user("admin")).toMatchObject({
      displayName: "Ada Admin",
      username: "ada",
    });
    expect(world.accounts.store.writes).toEqual(["users.updateProfile:admin"]);
  });

  it.each(["manager", "employee"] as const)(
    "keeps the profile of a %s read-only",
    async (id) => {
      const { world } = directory();
      const actor = world.accounts.user(id);

      await expect(
        world.legacyService().updateOwnProfile(actor, {
          ...profile,
          role: actor.role,
        }),
      ).rejects.toBeInstanceOf(UserManagementDeniedError);
      expect(world.accounts.store.writes).toEqual([]);
    },
  );

  it("reports a user who no longer exists", async () => {
    const { world, admin } = directory();
    world.accounts.store.users.delete("admin");

    await expect(
      world.legacyService().updateOwnProfile(admin, profile),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it("refuses a username or address of another person", async () => {
    const { world, admin } = directory();
    const service = world.legacyService();

    await expect(
      service.updateOwnProfile(admin, { ...profile, username: "MANAGER" }),
    ).rejects.toBeInstanceOf(UsernameTakenError);
    await expect(
      service.updateOwnProfile(admin, {
        ...profile,
        email: "manager@example.test",
      }),
    ).rejects.toBeInstanceOf(EmailTakenError);
    expect(world.accounts.store.writes).toEqual([]);
  });

  it("keeps the own address and username without conflict", async () => {
    const { world, admin } = directory();

    await expect(
      world.legacyService().updateOwnProfile(admin, {
        ...profile,
        username: "admin",
        email: "admin@example.test",
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses to demote the last administrator", async () => {
    const { world, admin } = directory();

    await expect(
      world
        .legacyService()
        .updateOwnProfile(admin, { ...profile, role: "manager" }),
    ).rejects.toBeInstanceOf(LastAdministratorError);
    expect(world.accounts.store.writes).toEqual([]);
  });

  it("lets an administrator step down while another one remains", async () => {
    const { world, admin } = directory();
    world.accounts.addAdministrator({ userId: "admin-2", legacyRole: "admin" });

    await world
      .legacyService()
      .updateOwnProfile(admin, { ...profile, role: "manager" });

    expect(world.accounts.user("admin").role).toBe("manager");
  });
});

describe("createUser", () => {
  const newEmployee = {
    id: "new-1",
    username: "nina",
    displayName: "Nina New",
    passwordHash: "hash",
    role: "employee",
    email: "nina@example.test",
  } as const;

  it("lets a manager create an employee", async () => {
    const { world, manager } = directory();

    await world.legacyService().createUser(manager, newEmployee);

    expect(world.accounts.user("new-1").role).toBe("employee");
  });

  it("refuses a manager creating a manager or an administrator", async () => {
    const { world, manager } = directory();
    const service = world.legacyService();

    await expect(
      service.createUser(manager, { ...newEmployee, role: "manager" }),
    ).rejects.toBeInstanceOf(RoleAssignmentDeniedError);
    await expect(
      service.createUser(manager, { ...newEmployee, role: "admin" }),
    ).rejects.toBeInstanceOf(RoleAssignmentDeniedError);
    expect(world.accounts.store.writes).toEqual([]);
  });

  it("refuses an employee", async () => {
    const { world, employee } = directory();

    await expect(
      world.legacyService().createUser(employee, newEmployee),
    ).rejects.toBeInstanceOf(UserManagementDeniedError);
  });

  it("refuses an address that is already taken", async () => {
    const { world, admin } = directory();

    await expect(
      world.legacyService().createUser(admin, {
        ...newEmployee,
        email: "manager@example.test",
      }),
    ).rejects.toBeInstanceOf(EmailTakenError);
    expect(world.accounts.store.writes).toEqual([]);
  });

  it("creates a temporary password that must be replaced", async () => {
    const { world, admin } = directory();
    const hasher = world.foreignHasher();

    const result = await world.legacyService().createWithTemporaryPassword(
      admin,
      {
        id: "new-2",
        username: "tom",
        displayName: "Tom Temp",
        role: "employee",
      },
      hasher,
    );

    expect(result.temporaryPassword).toMatch(TEMPORARY_PASSWORD);
    expect(world.accounts.store.users.get("new-2")?.passwordHash).toBe(
      `hashed:${result.temporaryPassword}`,
    );
    expect(world.accounts.user("new-2").mustChangePassword).toBe(true);
  });

  it("creates no account for an actor who may not manage users", async () => {
    const { world, employee } = directory();

    await expect(
      world.legacyService().createWithTemporaryPassword(
        employee,
        {
          id: "new-3",
          username: "eve",
          displayName: "Eve",
          role: "employee",
        },
        world.foreignHasher(),
      ),
    ).rejects.toBeInstanceOf(UserManagementDeniedError);
    expect(world.accounts.store.users.has("new-3")).toBe(false);
  });
});

describe("changing another user", () => {
  it("lets a manager deactivate and reactivate an employee", async () => {
    const { world, manager } = directory();
    const service = world.legacyService();

    await service.setActive(manager, "employee", false);
    expect(world.accounts.user("employee").isActive).toBe(false);

    await service.setActive(manager, "employee", true);
    expect(world.accounts.user("employee").isActive).toBe(true);
  });

  it.each([
    ["an administrator", "admin"],
    ["another manager", "manager-2"],
  ])("refuses a manager acting on %s", async (_, targetId) => {
    const { world, manager } = directory();
    world.accounts.addAccount({ userId: "manager-2", legacyRole: "manager" });
    const service = world.legacyService();

    await expect(
      service.setActive(manager, targetId, false),
    ).rejects.toBeInstanceOf(UserManagementDeniedError);
    await expect(
      service.setRole(manager, targetId, "employee"),
    ).rejects.toBeInstanceOf(UserManagementDeniedError);
    await expect(
      service.updateUser(manager, targetId, {
        displayName: "X",
        username: "x",
        email: null,
      }),
    ).rejects.toBeInstanceOf(UserManagementDeniedError);
    await expect(
      service.resetPassword(manager, targetId, world.foreignHasher()),
    ).rejects.toBeInstanceOf(UserManagementDeniedError);
    expect(world.accounts.store.writes).toEqual([]);
  });

  it("refuses an employee and reports an unknown target", async () => {
    const { world, employee, admin } = directory();
    const service = world.legacyService();

    await expect(
      service.setActive(employee, "manager", false),
    ).rejects.toBeInstanceOf(UserManagementDeniedError);
    await expect(
      service.setActive(admin, "ghost", false),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it("keeps the last active administrator", async () => {
    const { world, admin } = directory();

    await expect(
      world.legacyService().setActive(admin, "admin", false),
    ).rejects.toBeInstanceOf(LastAdministratorError);
    expect(world.accounts.user("admin").isActive).toBe(true);
  });

  it("updates the profile of an employee and guards the address", async () => {
    const { world, manager } = directory();
    const service = world.legacyService();

    await service.updateUser(manager, "employee", {
      displayName: "Emma Employee",
      username: "emma",
      email: "emma@example.test",
    });
    expect(world.accounts.user("employee").username).toBe("emma");

    await expect(
      service.updateUser(manager, "employee", {
        displayName: "Emma",
        username: "emma",
        email: "admin@example.test",
      }),
    ).rejects.toBeInstanceOf(EmailTakenError);
  });

  it("resets a password and returns the temporary one once", async () => {
    const { world, manager } = directory();

    const result = await world
      .legacyService()
      .resetPassword(manager, "employee", world.foreignHasher());

    expect(result.temporaryPassword).toMatch(TEMPORARY_PASSWORD);
    expect(world.accounts.store.users.get("employee")?.passwordHash).toBe(
      `hashed:${result.temporaryPassword}`,
    );
    expect(world.accounts.user("employee").mustChangePassword).toBe(true);
  });
});

describe("setRole", () => {
  it("lets an administrator promote an employee", async () => {
    const { world, admin } = directory();

    await world.legacyService().setRole(admin, "employee", "manager");

    expect(world.accounts.user("employee").role).toBe("manager");
  });

  it("refuses a manager promoting an employee beyond the employee role", async () => {
    const { world, manager } = directory();

    await expect(
      world.legacyService().setRole(manager, "employee", "manager"),
    ).rejects.toBeInstanceOf(RoleAssignmentDeniedError);
    expect(world.accounts.user("employee").role).toBe("employee");
  });

  it("refuses to demote the last active administrator", async () => {
    const { world, admin } = directory();

    await expect(
      world.legacyService().setRole(admin, "admin", "manager"),
    ).rejects.toBeInstanceOf(LastAdministratorError);
  });

  it("lets an administrator demote another one", async () => {
    const { world, admin } = directory();
    world.accounts.addAdministrator({ userId: "admin-2", legacyRole: "admin" });

    await world.legacyService().setRole(admin, "admin-2", "employee");

    expect(world.accounts.user("admin-2").role).toBe("employee");
  });
});

describe("avatar and password storage", () => {
  const avatar = {
    mimeType: "image/png",
    filename: "me.png",
    data: Buffer.from("png"),
  };

  it("stores the image and the reference of the own avatar", async () => {
    const { world } = directory();
    const service = world.legacyService();

    await service.updateOwnAvatar("employee", {
      ...avatar,
      avatarType: "image",
      avatarImageUrl: "/avatars/employee",
    });

    await expect(service.getAvatar("employee")).resolves.toEqual(avatar);
    expect(world.accounts.user("employee")).toMatchObject({
      avatarType: "image",
      avatarImageUrl: "/avatars/employee",
    });
  });

  it("replaces a stored password hash without a permission check", async () => {
    const { world } = directory();
    const update = vi.spyOn(world.repository, "updatePasswordHash");

    await world.legacyService().updatePasswordHash("employee", "new-hash");

    expect(update).toHaveBeenCalledWith("employee", "new-hash");
    expect(world.accounts.store.users.get("employee")?.passwordHash).toBe(
      "new-hash",
    );
  });

  it("finds credentials by username", async () => {
    const { world } = directory();
    const service = world.legacyService();

    await expect(
      service.findCredentialsByUsername("EMPLOYEE"),
    ).resolves.toMatchObject({ user: { id: "employee" } });
    await expect(
      service.findCredentialsByUsername("ghost"),
    ).resolves.toBeNull();
  });
});
