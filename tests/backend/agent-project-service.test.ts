import { describe, expect, it } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { AgentProjectService } from "@/backend/service/mcp/AgentProjectService";
import { ProjectService } from "@/backend/service/ProjectService";
import { createAccess, createRole } from "../helpers/authorization";
import { createUser } from "../helpers/factories";
import { useMigratedDatabase } from "../helpers/test-database";

import type { AccountAccess } from "@/definition/Authorization";

const ACTOR = createUser({ id: "actor", role: "admin" });

describe("agent project name listing", () => {
  const getDatabase = useMigratedDatabase();

  async function setup(account: AccountAccess = createAccess()) {
    const authorization = new AuthorizationRepository(getDatabase());
    await authorization.users().insert({
      id: "actor",
      username: "actor",
      displayName: "Actor",
      role: "employee",
      passwordHash: "hash",
    });
    if (account.role) await authorization.saveRole(account.role);
    await authorization.saveAccount(account);
    for (const id of ["frontend", "backend"])
      await authorization.saveDepartment({ id, name: id });
    const repository = new ProjectRepository(getDatabase());
    for (const [id, name, departmentIds] of [
      ["shared", "Shared project", ["frontend", "backend"]],
      ["foreign", "Backend only", ["backend"]],
      ["public", "Public project", []],
      ["retired", "Archived project", []],
    ] as const) {
      await repository.insert({
        id,
        name,
        description: `Confidential ${id} description`,
        status: "active",
        placeholderColor: "#FCE3D3",
        ownerId: "actor",
        departmentIds,
      });
    }
    await repository.archive("retired");
    return {
      authorization,
      service: new AgentProjectService(repository),
      projects: new ProjectService(
        repository,
        new PermissionService(),
        null,
        new ServerCache(),
      ),
    };
  }

  it("returns exactly the names the existing project read rules allow, without identifiers or content", async () => {
    const { service, projects } = await setup();
    const names = await service.listNames("actor");
    expect(names.sort()).toEqual(["Public project", "Shared project"]);
    expect(names).toEqual(
      (await projects.findAll(ACTOR)).map((project) => project.name),
    );
    expect(JSON.stringify(names)).not.toMatch(/Confidential|"shared"|"public"/);
  });

  it("follows the current rights at the next call", async () => {
    const { authorization, service } = await setup();
    await authorization.saveAccount(createAccess({ departments: ["backend"] }));
    expect((await service.listNames("actor")).sort()).toEqual([
      "Backend only",
      "Public project",
      "Shared project",
    ]);
    await authorization.saveAccount(createAccess({ departments: [] }));
    expect(await service.listNames("actor")).toEqual(["Public project"]);
    await authorization.saveRole(createRole({ departmentBound: false }));
    expect(await service.listNames("actor")).toHaveLength(3);
  });

  it("counts the personal administrator property in role mode, unlike the browser policy", async () => {
    const { service, projects } = await setup(
      createAccess({ isAdmin: true, mode: "role", departments: [] }),
    );
    expect(await service.listNames("actor")).toHaveLength(3);
    expect(await projects.findAll(ACTOR)).toHaveLength(1);
  });

  it("fails closed for inactive and unknown accounts", async () => {
    const { service } = await setup();
    await getDatabase().execute(
      "UPDATE users SET is_active = 0 WHERE id = 'actor';",
    );
    await expect(service.listNames("actor")).rejects.toThrow(
      McpAuthorizationError,
    );
    await expect(service.listNames("missing")).rejects.toMatchObject({
      status: 401,
    });
  });
});
