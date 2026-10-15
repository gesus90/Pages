import { describe, expect, it } from "vitest";

import { UsernameTakenError } from "@/backend/error/UserErrors";

import { expectRejection } from "./administration-assertions";
import { organizationWorld } from "./administration-directory";

import type { AccountProfileInput } from "@/definition/Authorization";

const PROFILE: AccountProfileInput = {
  username: "  sally ",
  firstName: " Sally ",
  lastName: " Sales ",
  email: "sally@example.test",
};

const TEMPORARY_PASSWORD = /^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){2}$/u;

describe("updateProfile", () => {
  it("replaces the identity fields of a person within reach", async () => {
    const world = organizationWorld();

    await world.service().updateProfile("hr", "emp-sales", PROFILE);

    expect(world.user("emp-sales")).toMatchObject({
      username: "sally",
      displayName: "Sally Sales",
    });
    expect(world.store.users.get("emp-sales")?.email).toBe(
      "sally@example.test",
    );
    expect(world.account("emp-sales")).toMatchObject({
      firstName: "Sally",
      lastName: "Sales",
      role: { id: "role-employee" },
    });
    expect(world.invalidations).toEqual(["invalidateUsers"]);
  });

  it("lets an administrator edit the own profile", async () => {
    const world = organizationWorld();

    await world.service().updateProfile("admin", "admin", PROFILE);

    expect(world.user("admin").username).toBe("sally");
  });

  it.each([
    ["an account without the role capability", "lead", "emp-sales"],
    ["a non-administrator editing the own profile", "hr", "hr"],
    ["a person outside the department scope", "hr", "emp-legal"],
    ["an administrator account", "hr", "admin"],
  ])("refuses %s", async (_, actor, target) => {
    const world = organizationWorld();

    await expectRejection(
      world.service().updateProfile(actor, target, PROFILE),
      "forbidden",
    );
    expect(world.writes).toEqual([]);
    expect(world.invalidations).toEqual([]);
  });

  it("reports an unknown target as not found", async () => {
    const world = organizationWorld();

    await expectRejection(
      world.service().updateProfile("admin", "ghost", PROFILE),
      "notFound",
    );
  });

  it.each([
    ["a blank username", { username: " " }],
    ["a malformed address", { email: "sally@" }],
    ["two blank names", { firstName: " ", lastName: "" }],
  ])("rejects %s", async (_, change) => {
    const world = organizationWorld();

    await expectRejection(
      world
        .service()
        .updateProfile("admin", "emp-sales", { ...PROFILE, ...change }),
      "invalidInput",
    );
    expect(world.writes).toEqual([]);
  });

  it("keeps the person unchanged when the username is taken", async () => {
    const world = organizationWorld();
    const before = world.user("emp-sales");

    await expect(
      world
        .service()
        .updateProfile("admin", "emp-sales", { ...PROFILE, username: "loose" }),
    ).rejects.toBeInstanceOf(UsernameTakenError);

    expect(world.user("emp-sales")).toEqual(before);
    expect(world.account("emp-sales").firstName).toBe("Synthetic");
    expect(world.invalidations).toEqual([]);
  });
});

describe("updateOwnDisplayProfile", () => {
  it("lets an administrator change the own display name", async () => {
    const world = organizationWorld();

    await world.service().updateOwnDisplayProfile("admin", {
      displayName: " Ada Admin ",
      username: "ada",
      email: "ada@example.test",
    });

    expect(world.user("admin").username).toBe("ada");
    expect(world.account("admin")).toMatchObject({
      firstName: "Ada Admin",
      lastName: "",
      isAdmin: true,
      mode: "admin",
    });
    expect(world.invalidations).toEqual(["invalidateUsers"]);
  });

  it("keeps the profile of everyone else read-only", async () => {
    const world = organizationWorld();

    await expectRejection(
      world.service().updateOwnDisplayProfile("hr", {
        displayName: "Hana Hr",
        username: "hana",
        email: null,
      }),
      "forbidden",
    );
    expect(world.writes).toEqual([]);
  });

  it("rejects an invalid profile before any lookup", async () => {
    const world = organizationWorld();

    await expectRejection(
      world.service().updateOwnDisplayProfile("admin", {
        displayName: "  ",
        username: "ada",
        email: null,
      }),
      "invalidInput",
    );
  });
});

describe("resetPassword", () => {
  it("replaces the password with a temporary one that must be changed", async () => {
    const world = organizationWorld();

    const result = await world.service().resetPassword("hr", "emp-sales");

    expect(result.temporaryPassword).toMatch(TEMPORARY_PASSWORD);
    expect(world.store.users.get("emp-sales")?.passwordHash).toBe(
      `hashed:${result.temporaryPassword}`,
    );
    expect(world.user("emp-sales").mustChangePassword).toBe(true);
  });

  it("lets an administrator reset the own password", async () => {
    const world = organizationWorld();

    await expect(
      world.service().resetPassword("admin", "admin"),
    ).resolves.toHaveProperty("temporaryPassword");
  });

  it.each([
    ["an account without user management", "writer", "loose"],
    ["a non-administrator resetting itself", "hr", "hr"],
    ["a person outside the department scope", "hr", "emp-legal"],
    ["an administrator account", "lead", "admin"],
  ])("refuses %s", async (_, actor, target) => {
    const world = organizationWorld();

    await expectRejection(
      world.service().resetPassword(actor, target),
      "forbidden",
    );
    expect(world.writes).toEqual([]);
  });

  it("reports an unknown target as not found", async () => {
    await expectRejection(
      organizationWorld().service().resetPassword("admin", "ghost"),
      "notFound",
    );
  });
});
