import { describe, expect, it } from "vitest";

import {
  activeAccount,
  findAccount,
  requireAdministration,
  requireNoAgentScope,
  requireUniqueAdministrationName,
  validateAdministrationName,
} from "@/backend/service/AdministrationAccess";

import { AuthorizationWorld } from "./authorization-world";
import { expectScopeLock } from "./administration-assertions";

import type { AuthorizationSnapshot } from "@/backend/database/repositories/AuthorizationRepository";

function snapshotWith(world: AuthorizationWorld): AuthorizationSnapshot {
  return {
    roles: world.store.roles,
    departments: world.store.departments,
    accounts: world.store.readAccounts(),
  };
}

function codeOf(work: () => unknown): unknown {
  try {
    work();
  } catch (error: unknown) {
    return error instanceof Error && "code" in error ? error.code : error;
  }

  return undefined;
}

describe("account lookup", () => {
  it("finds an account by its user identifier", () => {
    const world = new AuthorizationWorld();
    world.addAccount({ userId: "anna" });

    expect(findAccount(snapshotWith(world), "anna").userId).toBe("anna");
  });

  it("reports an unknown account as not found", () => {
    const world = new AuthorizationWorld();

    expect(codeOf(() => findAccount(snapshotWith(world), "ghost"))).toBe(
      "notFound",
    );
  });

  it("returns an active actor", () => {
    const world = new AuthorizationWorld();
    world.addAccount({ userId: "anna" });

    expect(activeAccount(snapshotWith(world), "anna").isActive).toBe(true);
  });

  it("refuses an inactive actor as forbidden", () => {
    const world = new AuthorizationWorld();
    world.addAccount({ userId: "anna", isActive: false });

    expect(codeOf(() => activeAccount(snapshotWith(world), "anna"))).toBe(
      "forbidden",
    );
  });

  it("reports an unknown actor as not found", () => {
    const world = new AuthorizationWorld();

    expect(codeOf(() => activeAccount(snapshotWith(world), "ghost"))).toBe(
      "notFound",
    );
  });
});

describe("requireAdministration", () => {
  it("passes an allowed decision", () => {
    expect(() => requireAdministration(true)).not.toThrow();
  });

  it("turns a refused decision into the forbidden error", () => {
    expect(codeOf(() => requireAdministration(false))).toBe("forbidden");
  });
});

describe("validateAdministrationName", () => {
  it("accepts a name up to 200 characters", () => {
    expect(() => validateAdministrationName("a".repeat(200))).not.toThrow();
  });

  it.each(["", "   ", "\t\n"])("rejects the blank name %j", (name) => {
    expect(codeOf(() => validateAdministrationName(name))).toBe("invalidInput");
  });

  it("rejects a name longer than 200 characters", () => {
    expect(codeOf(() => validateAdministrationName("a".repeat(201)))).toBe(
      "invalidInput",
    );
  });
});

describe("requireUniqueAdministrationName", () => {
  const records = [
    { id: "sales", name: "Sales" },
    { id: "ops", name: "Operations" },
  ];

  it("accepts a free name", () => {
    expect(() =>
      requireUniqueAdministrationName(records, { id: "hr", name: "People" }),
    ).not.toThrow();
  });

  it("refuses a name of another record regardless of case and padding", () => {
    expect(
      codeOf(() =>
        requireUniqueAdministrationName(records, {
          id: "hr",
          name: "  SALES ",
        }),
      ),
    ).toBe("invalidInput");
  });

  it("lets a record keep its own name", () => {
    expect(() =>
      requireUniqueAdministrationName(records, {
        id: "sales",
        name: "sales",
      }),
    ).not.toThrow();
  });
});

describe("requireNoAgentScope", () => {
  it("passes when nothing references the target", async () => {
    const world = new AuthorizationWorld();
    const actor = world.addAdministrator();

    await expect(
      requireNoAgentScope(world.repository, actor, {
        kind: "group",
        targetId: "g1",
      }),
    ).resolves.toBeUndefined();
  });

  it("names agents and connections to an administrator in admin mode", async () => {
    const world = new AuthorizationWorld();
    const actor = world.addAdministrator();
    world.store.agentProfileReferences.set("department:sales", [
      { id: "a1", name: "Sales agent" },
    ]);
    world.store.connectionReferences.set("department:sales", [
      { id: "c1", name: "Sales connection" },
    ]);

    await expectScopeLock(
      requireNoAgentScope(world.repository, actor, {
        kind: "department",
        targetId: "sales",
      }),
      ["Sales agent", "Sales connection"],
    );
  });

  it("withholds the names from an actor who is not an administrator", async () => {
    const world = new AuthorizationWorld();
    const actor = world.addAccount({ userId: "manager" });
    world.store.agentProfileReferences.set("group:g1", [
      { id: "a1", name: "Secret agent" },
    ]);

    await expectScopeLock(
      requireNoAgentScope(world.repository, actor, {
        kind: "group",
        targetId: "g1",
      }),
      [],
    );
  });

  it("withholds the names from an administrator in role mode", async () => {
    const world = new AuthorizationWorld();
    const actor = world.addAdministrator({ mode: "role" });
    world.store.connectionReferences.set("group:g1", [
      { id: "c1", name: "Shared connection" },
    ]);

    await expectScopeLock(
      requireNoAgentScope(world.repository, actor, {
        kind: "group",
        targetId: "g1",
      }),
      [],
    );
  });
});
