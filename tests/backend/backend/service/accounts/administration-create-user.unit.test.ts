import { describe, expect, it, vi } from "vitest";

import {
  EmailTakenError,
  UsernameTakenError,
} from "@/backend/error/UserErrors";
import { CAPABILITY } from "@/definition/Authorization";

import { expectRejection } from "./administration-assertions";
import { organizationWorld } from "./administration-directory";

import type { AccountCreateInput } from "@/definition/Authorization";

const NEW_EMPLOYEE: AccountCreateInput = {
  username: "  newbie ",
  firstName: " Nora ",
  lastName: " Newbie ",
  email: "nora@example.test",
  roleId: "role-employee",
  isAdmin: false,
  departments: [],
};

const TEMPORARY_PASSWORD = /^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){2}$/u;

describe("createUser success", () => {
  it("creates an account with a temporary password that must be replaced", async () => {
    const world = organizationWorld();

    const result = await world.service().createUser("hr", NEW_EMPLOYEE);

    expect(result.temporaryPassword).toMatch(TEMPORARY_PASSWORD);
    const created = world.findByUsername("newbie");
    expect(created).toMatchObject({
      displayName: "Nora Newbie",
      mustChangePassword: true,
      isActive: true,
      role: "employee",
    });
    const stored = world.store.users.get(created?.id ?? "");
    expect(stored?.passwordHash).toBe(`hashed:${result.temporaryPassword}`);
    expect(stored?.email).toBe("nora@example.test");
  });

  it("stores the authorization facts of the new account", async () => {
    const world = organizationWorld();

    await world.service().createUser("hr", NEW_EMPLOYEE);

    const created = world.findByUsername("newbie");
    expect(world.account(created?.id ?? "")).toMatchObject({
      firstName: "Nora",
      lastName: "Newbie",
      isAdmin: false,
      mode: "role",
      role: { id: "role-employee" },
      departments: [],
      allDepartments: false,
      allProjects: false,
    });
    expect(world.invalidations).toEqual(["invalidateUsers"]);
  });

  it("lets an administrator create another administrator without a role", async () => {
    const world = organizationWorld();

    await world.service().createUser("admin", {
      ...NEW_EMPLOYEE,
      username: "second-admin",
      roleId: null,
      isAdmin: true,
    });

    const created = world.findByUsername("second-admin");
    expect(created?.role).toBe("admin");
    expect(world.account(created?.id ?? "")).toMatchObject({
      isAdmin: true,
      mode: "admin",
      role: null,
    });
  });

  it("places the new account in departments the actor manages", async () => {
    const world = organizationWorld();

    await world
      .service()
      .createUser("lead", { ...NEW_EMPLOYEE, departments: ["sales"] });

    const created = world.findByUsername("newbie");
    expect(world.account(created?.id ?? "").departments).toEqual(["sales"]);
  });
});

describe("createUser authorization", () => {
  it("refuses an account without the user management capability", async () => {
    const world = organizationWorld();

    await expectRejection(
      world.service().createUser("writer", NEW_EMPLOYEE),
      "forbidden",
    );
    expect(world.writes).toEqual([]);
  });

  it("refuses an inactive actor", async () => {
    const world = organizationWorld();
    world.setUserActive("hr", false);

    await expectRejection(
      world.service().createUser("hr", NEW_EMPLOYEE),
      "forbidden",
    );
  });

  it("refuses an administrator account created by a non-administrator", async () => {
    const world = organizationWorld();

    await expectRejection(
      world
        .service()
        .createUser("hr", { ...NEW_EMPLOYEE, roleId: null, isAdmin: true }),
      "forbidden",
    );
    expect(world.writes).toEqual([]);
  });

  it("refuses a role of a higher rank than the actor's", async () => {
    const world = organizationWorld();
    world.addRole({ roleId: "role-director", rank: 9 });

    await expectRejection(
      world
        .service()
        .createUser("hr", { ...NEW_EMPLOYEE, roleId: "role-director" }),
      "forbidden",
    );
  });

  it("refuses a role with a capability the actor lacks", async () => {
    const world = organizationWorld();
    world.addRole({
      roleId: "role-planner",
      rank: 1,
      permissions: [CAPABILITY.WRITE, CAPABILITY.MILESTONES],
    });

    await expectRejection(
      world
        .service()
        .createUser("hr", { ...NEW_EMPLOYEE, roleId: "role-planner" }),
      "forbidden",
    );
  });

  it("refuses departments outside the actor's management range", async () => {
    const world = organizationWorld();

    await expectRejection(
      world
        .service()
        .createUser("lead", { ...NEW_EMPLOYEE, departments: ["legal"] }),
      "forbidden",
    );
    expect(world.writes).toEqual([]);
  });
});

describe("createUser validation", () => {
  const invalidInputs: ReadonlyArray<
    readonly [string, Partial<AccountCreateInput>]
  > = [
    ["a blank username", { username: "   " }],
    ["a blank first name", { firstName: "  " }],
    ["a blank last name", { lastName: "" }],
    ["a first name over 200 characters", { firstName: "n".repeat(201) }],
    ["a malformed email address", { email: "not-an-address" }],
    [
      "an email address over 320 characters",
      { email: `${"a".repeat(320)}@x.test` },
    ],
    ["no role for a non-administrator", { roleId: null }],
    ["an unknown role", { roleId: "role-missing" }],
  ];

  it.each(invalidInputs)("rejects %s without a write", async (_, change) => {
    const world = organizationWorld();

    await expectRejection(
      world.service().createUser("admin", { ...NEW_EMPLOYEE, ...change }),
      "invalidInput",
    );
    expect(world.writes).toEqual([]);
    expect(world.invalidations).toEqual([]);
  });

  it("rejects an unknown department", async () => {
    const world = organizationWorld();

    await expectRejection(
      world
        .service()
        .createUser("admin", { ...NEW_EMPLOYEE, departments: ["missing"] }),
      "invalidInput",
    );
    expect(world.writes).toEqual([]);
  });

  it("accepts a missing email address", async () => {
    const world = organizationWorld();

    await expect(
      world.service().createUser("hr", { ...NEW_EMPLOYEE, email: null }),
    ).resolves.toHaveProperty("temporaryPassword");
  });
});

describe("createUser conflicts", () => {
  it("refuses an address that is already taken before writing anything", async () => {
    const world = organizationWorld();

    await expect(
      world
        .service()
        .createUser("hr", { ...NEW_EMPLOYEE, email: "sales@example.test" }),
    ).rejects.toBeInstanceOf(EmailTakenError);
    expect(world.writes).toEqual([]);
    expect(world.invalidations).toEqual([]);
  });

  it("leaves no account behind when the username is taken", async () => {
    const world = organizationWorld();
    const usersBefore = world.store.users.size;

    await expect(
      world.service().createUser("hr", { ...NEW_EMPLOYEE, username: "LOOSE" }),
    ).rejects.toBeInstanceOf(UsernameTakenError);

    expect(world.store.users.size).toBe(usersBefore);
    expect(
      world.writes.filter((write) => write.startsWith("saveAccount")),
    ).toEqual([]);
    expect(world.invalidations).toEqual([]);
  });

  it("rolls the user row back when saving the authorization fails", async () => {
    const world = organizationWorld();
    const usersBefore = world.store.users.size;
    vi.spyOn(world.repository, "saveAccount").mockRejectedValue(
      new Error("write failed"),
    );

    await expect(
      world.service().createUser("hr", NEW_EMPLOYEE),
    ).rejects.toThrow("write failed");

    expect(world.writes.some((write) => write.startsWith("users.insert"))).toBe(
      true,
    );
    expect(world.store.users.size).toBe(usersBefore);
    expect(world.findByUsername("newbie")).toBeNull();
    expect(world.invalidations).toEqual([]);
  });
});
