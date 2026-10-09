import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { ServerCache } from "@/backend/cache/ServerCache";
import { Database } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { AdministrationService } from "@/backend/service/AdministrationService";
import { CAPABILITY } from "@/definition/Authorization";

import { createRole } from "../helpers/authorization";

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pages-role-persistence-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function openDatabase(file: string): Promise<{
  readonly database: Database;
  readonly repository: AuthorizationRepository;
  readonly service: AdministrationService;
}> {
  const database = await Database.create(file);
  await database.migrate(DATABASE_MIGRATIONS);
  const repository = new AuthorizationRepository(database);
  return {
    database,
    repository,
    service: new AdministrationService(
      repository,
      new ServerCache(),
      new PasswordHasher(),
    ),
  };
}

async function readRoles(repository: AuthorizationRepository): Promise<{
  readonly lead: unknown;
  readonly targetRole: string | null;
}> {
  const snapshot = await repository.snapshot();
  const lead = snapshot.roles.find((role) => role.id === "lead");
  return {
    lead: lead && { ...lead, permissions: [...lead.permissions].sort() },
    targetRole:
      snapshot.accounts.find((account) => account.userId === "target")?.role
        ?.id ?? null,
  };
}

// A7 §21.2: role edits and assignments must survive reopening and a server restart.
describe("role persistence across a database restart", () => {
  it("keeps edited roles and assignments after closing and reopening the file", async () => {
    const file = path.join(directory, "pages.duckdb");
    let instance = await openDatabase(file);
    await instance.repository.transaction(async (scope) => {
      await scope.saveRole(
        createRole({
          id: "lead",
          name: "Lead",
          rank: 30,
          permissions: [CAPABILITY.WRITE, CAPABILITY.MILESTONES],
        }),
      );
      await scope.saveRole(
        createRole({
          id: "member",
          name: "Member",
          rank: 10,
          permissions: [CAPABILITY.WRITE],
        }),
      );
      for (const [id, roleId, isAdmin] of [
        ["admin", "lead", true],
        ["target", "member", false],
      ] as const) {
        await scope.users().insert({
          id,
          username: id,
          displayName: id,
          role: isAdmin ? "admin" : "employee",
          passwordHash: "hash",
          authorization: {
            roleId,
            isAdmin,
            mode: isAdmin ? "admin" : "role",
            firstName: id,
            lastName: "",
          },
        });
      }
    });
    const edited = createRole({
      id: "lead",
      name: "Leitung",
      rank: 35,
      departmentBound: false,
      permissions: [CAPABILITY.WRITE, CAPABILITY.MANAGE_PROJECTS],
    });
    await instance.service.saveRole("admin", edited);
    await instance.service.assignRole("admin", "target", "lead");
    await instance.database.close();

    instance = await openDatabase(file);
    const expected = {
      lead: {
        ...edited,
        permissions: [CAPABILITY.MANAGE_PROJECTS, CAPABILITY.WRITE].sort(),
      },
      targetRole: "lead",
    };
    expect(await readRoles(instance.repository)).toEqual(expected);

    // Saving the same permissions again replaces identical keys in one transaction.
    await instance.service.saveRole("admin", edited);
    await instance.database.close();
    instance = await openDatabase(file);
    expect(await readRoles(instance.repository)).toEqual(expected);
    await instance.database.close();
  });
});
