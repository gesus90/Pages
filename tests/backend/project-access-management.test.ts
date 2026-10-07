import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ProjectPolicyService } from "@/backend/auth/ProjectPolicyService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { ProjectDepartmentRepository } from "@/backend/database/repositories/project/ProjectDepartmentRepository";
import { ProjectService } from "@/backend/service/ProjectService";
import { createAccess, createRole } from "../helpers/authorization";
import { createUser } from "../helpers/factories";
import { useMigratedDatabase } from "../helpers/test-database";

import type { AccountAccess } from "@/definition/Authorization";

const ACTOR = createUser({ id: "actor", role: "admin" });
const GENERAL = {
  name: "Updated",
  description: "Description",
  status: "active" as const,
  progress: 10,
};
const DETAILS = {
  ...GENERAL,
  notes: "Notes",
  managerId: null,
  startDate: null,
  targetDate: null,
};

describe("department project access and atomic management", () => {
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
    for (const id of ["frontend", "backend", "other"])
      await authorization.saveDepartment({ id, name: id });
    const repository = new ProjectRepository(getDatabase());
    for (const [id, departmentIds] of [
      ["shared", ["frontend", "backend"]],
      ["foreign", ["backend"]],
      ["public", []],
    ] as const) {
      await repository.insert({
        id,
        name: id,
        description: "",
        status: "active",
        placeholderColor: "#FCE3D3",
        ownerId: "actor",
        departmentIds,
      });
      await repository.updateMemberRole(id, "actor", "member");
    }
    const cache = new ServerCache();
    const service = new ProjectService(
      repository,
      new PermissionService(),
      null,
      cache,
    );
    return { authorization, repository, cache, service };
  }

  it("reads common and public projects without membership, and never widens a bound member's access", async () => {
    const { service, repository } = await setup();
    await repository.removeMember("shared", "actor");
    await repository.updateMemberRole("foreign", "actor", "manager");
    expect(
      (await service.findAll(ACTOR)).map((project) => project.id).sort(),
    ).toEqual(["public", "shared"]);
    expect((await service.getById(ACTOR, "shared")).departments).toHaveLength(
      2,
    );
    await expect(service.getById(ACTOR, "foreign")).rejects.toThrow(
      "not allowed",
    );
    expect(await service.canWriteProject(ACTOR, "foreign")).toBe(false);
    expect(await service.canWriteProject(ACTOR, "missing")).toBe(false);
    expect((await service.permissions(ACTOR, "foreign")).canEditGeneral).toBe(
      false,
    );
    await expect(
      service.findAll(createUser({ id: "missing" })),
    ).rejects.toThrow("not allowed");
  });

  it("re-evaluates memberships, role binding, active state and department names before cache hits", async () => {
    const { authorization, service, repository } = await setup();
    await service.findAll(ACTOR);
    await authorization.saveAccount(createAccess({ departments: ["backend"] }));
    expect(
      (await service.findAll(ACTOR)).map((project) => project.id).sort(),
    ).toEqual(["foreign", "public", "shared"]);
    await authorization.saveDepartment({ id: "backend", name: "Renamed" });
    expect(
      (await service.findAll(ACTOR)).find((project) => project.id === "foreign")
        ?.departments,
    ).toEqual([{ id: "backend", name: "Renamed" }]);
    await authorization.saveAccount(createAccess({ departments: [] }));
    expect((await service.findAll(ACTOR)).map((project) => project.id)).toEqual(
      ["public"],
    );
    await authorization.saveRole(createRole({ departmentBound: false }));
    expect(await service.findAll(ACTOR)).toHaveLength(3);
    await repository.archive("foreign");
    expect(await service.findAll(ACTOR)).toHaveLength(2);
    await expect(service.getById(ACTOR, "foreign")).rejects.toThrow(
      "does not exist",
    );
    await getDatabase().execute(
      "UPDATE users SET is_active = 0 WHERE id = 'actor';",
    );
    await expect(service.findAll(ACTOR)).rejects.toThrow("not allowed");
    await expect(service.getById(ACTOR, "shared")).rejects.toThrow(
      "not allowed",
    );
  });

  it("exposes only own ticket departments even with an unbound role or global project scope", async () => {
    const { authorization, service } = await setup(
      createAccess({ allProjects: true }),
    );
    expect(await service.workItemVisibility(ACTOR)).toEqual({
      departmentIds: ["frontend"],
      projectIds: ["foreign", "public", "shared"],
    });
    await authorization.saveAccount(
      createAccess({ isAdmin: true, mode: "admin", role: null }),
    );
    expect((await service.workItemVisibility(ACTOR)).departmentIds).toBeNull();
  });

  it("allows scoped co-owners to edit general values and icons but reserves full-scope actions", async () => {
    const { service, repository } = await setup(
      createAccess({ managedDepartments: ["frontend"] }),
    );
    expect(await service.permissions(ACTOR, "shared")).toEqual({
      canEditGeneral: true,
      canChangeDepartments: false,
      canArchive: false,
      canDelete: false,
    });
    await service.update(ACTOR, "shared", GENERAL);
    await service.updateDetails(ACTOR, "shared", DETAILS);
    await service.replaceIcon(ACTOR, "shared", {
      data: Buffer.from([1]),
      mimeType: "image/png",
      filename: "icon.png",
    });
    expect((await repository.findById("shared"))?.hasIcon).toBe(true);
    await expect(
      service.setDepartments(ACTOR, "shared", ["frontend"]),
    ).rejects.toThrow("not allowed");
    await expect(service.archive(ACTOR, "shared")).rejects.toThrow(
      "not allowed",
    );
    await expect(service.deletePermanently(ACTOR, "shared")).rejects.toThrow(
      "not allowed",
    );
  });

  it("retains multiple project manager roles with access, independently of global capabilities", async () => {
    const { repository, service } = await setup(
      createAccess({ role: createRole({ permissions: [] }) }),
    );
    expect(await service.canWriteProject(ACTOR, "shared")).toBe(false);
    await repository.updateMemberRole("shared", "actor", "manager");
    expect(await service.canWriteProject(ACTOR, "shared")).toBe(true);
    await service.updateDetails(ACTOR, "shared", DETAILS);
    await expect(
      service.setDepartments(ACTOR, "shared", ["frontend"]),
    ).rejects.toThrow("not allowed");
    await expect(service.archive(ACTOR, "shared")).rejects.toThrow(
      "not allowed",
    );
  });

  it("validates minimum, unknown and new out-of-scope assignments before replacing any relation", async () => {
    const { repository, service } = await setup();
    await expect(
      service.setDepartments(ACTOR, "shared", []),
    ).rejects.toMatchObject({ code: "departmentRequired" });
    await expect(
      service.setDepartments(ACTOR, "shared", ["missing"]),
    ).rejects.toMatchObject({ code: "invalidDepartment" });
    await expect(
      service.setDepartments(ACTOR, "shared", ["other"]),
    ).rejects.toMatchObject({ code: "departmentOutOfScope" });
    expect(await repository.findDepartments("shared")).toHaveLength(2);
    await service.setDepartments(ACTOR, "shared", ["frontend", "frontend"]);
    expect(await repository.findDepartments("shared")).toEqual([
      { id: "frontend", name: "frontend" },
    ]);
  });

  it("rolls back a failed assignment replacement and invalidates derived caches only after success", async () => {
    const { cache, repository, service } = await setup();
    for (const key of [
      "projects:list:old",
      "project:shared",
      "assignees:old",
      "workitems:old",
      "labels:old",
      "github:old",
    ])
      cache.set(key, ["old"], 60_000);
    vi.spyOn(
      ProjectDepartmentRepository.prototype,
      "replace",
    ).mockRejectedValueOnce(new Error("Failed assignment"));
    await expect(
      service.setDepartments(ACTOR, "shared", ["frontend"]),
    ).rejects.toThrow("Failed assignment");
    expect(await repository.findDepartments("shared")).toHaveLength(2);
    expect(cache.get("projects:list:old")).toEqual(["old"]);
    await service.setDepartments(ACTOR, "shared", ["frontend"]);
    expect(cache.readStats().entries).toBe(0);
  });

  it("repairs projects after the last assigned department is deleted and applies the minimum to general saves", async () => {
    const { authorization, repository, service } = await setup();
    await repository.updateMemberRole("shared", "actor", "manager");
    await authorization.deleteDepartment("frontend");
    await authorization.deleteDepartment("backend");
    await expect(
      service.update(ACTOR, "shared", GENERAL),
    ).rejects.toMatchObject({ code: "departmentRequired" });
    await expect(
      service.updateDetails(ACTOR, "shared", DETAILS),
    ).rejects.toMatchObject({ code: "departmentRequired" });
    await expect(
      service.setDepartments(ACTOR, "shared", []),
    ).rejects.toMatchObject({ code: "departmentRequired" });
    await authorization.saveAccount(createAccess({ allProjects: true }));
    await service.setDepartments(ACTOR, "shared", ["other"]);
    await service.update(ACTOR, "shared", GENERAL);
    await authorization.deleteDepartment("other");
    await service.setDepartments(ACTOR, "shared", []);
    await service.updateDetails(ACTOR, "shared", DETAILS);
    expect((await repository.findById("shared"))?.departments).toEqual([]);
  });

  it("archives with the separate capability and exposes scoped metadata while keeping active reads closed", async () => {
    const { authorization, repository, service } = await setup();
    await authorization.saveRole(
      createRole({ permissions: ["manage_projects"] }),
    );
    await expect(service.archive(ACTOR, "shared")).rejects.toThrow(
      "not allowed",
    );
    await authorization.saveRole(
      createRole({ permissions: ["archive_projects"] }),
    );
    await service.archive(ACTOR, "shared");
    await repository.archive("foreign");
    expect(
      (await service.findArchived(ACTOR)).map((project) => project.id),
    ).toEqual(["shared"]);
    expect(await service.permissions(ACTOR, "shared")).toEqual({
      canEditGeneral: false,
      canChangeDepartments: false,
      canArchive: false,
      canDelete: false,
    });
    await expect(service.getById(ACTOR, "shared")).rejects.toThrow(
      "does not exist",
    );
    await expect(service.permissions(ACTOR, "missing")).rejects.toThrow(
      "does not exist",
    );
    expect(await service.permissions(ACTOR, "foreign")).toEqual({
      canEditGeneral: false,
      canChangeDepartments: false,
      canArchive: false,
      canDelete: false,
    });
  });

  it("requires active personal administrator mode for deleting either active or archived projects", async () => {
    const { authorization, repository, service, cache } = await setup(
      createAccess({ isAdmin: true, mode: "role" }),
    );
    expect(await service.canDeleteProjects(ACTOR)).toBe(false);
    await expect(service.deletePermanently(ACTOR, "shared")).rejects.toThrow(
      "not allowed",
    );
    await authorization.saveAccount(
      createAccess({ isAdmin: true, mode: "admin", role: null }),
    );
    await repository.archive("shared");
    expect(await service.canDeleteProjects(ACTOR)).toBe(true);
    expect((await service.permissions(ACTOR, "shared")).canDelete).toBe(true);
    cache.set("statuses:old", [], 60_000);
    cache.set("project:foreign", [], 60_000);
    await service.deletePermanently(ACTOR, "shared");
    await service.deletePermanently(ACTOR, "foreign");
    expect(await repository.findArchivedById("shared")).toBeNull();
    expect(await repository.findById("foreign")).toBeNull();
    expect(cache.readStats().entries).toBe(0);
    await expect(service.deletePermanently(ACTOR, "missing")).rejects.toThrow(
      "does not exist",
    );
  });

  it.each([
    { name: " " },
    { name: "x".repeat(201) },
    { description: "x".repeat(10_001) },
    { progress: -1 },
    { progress: 101 },
    { progress: 1.5 },
  ])(
    "rejects invalid general project fields before writing: %j",
    async (changes) => {
      const { repository, service } = await setup();
      await expect(
        service.update(ACTOR, "shared", { ...GENERAL, ...changes }),
      ).rejects.toThrow();
      expect((await repository.findById("shared"))?.name).toBe("shared");
    },
  );
});

describe("project read policy edge cases", () => {
  const policy = new ProjectPolicyService();
  it("keeps missing-role accounts limited to public projects, while explicit global scope and admin mode grant access", () => {
    expect(policy.canAccess(createAccess({ role: null }), ["backend"])).toBe(
      false,
    );
    expect(policy.canAccess(createAccess({ role: null }), [])).toBe(true);
    expect(
      policy.canAccess(createAccess({ allProjects: true }), ["backend"]),
    ).toBe(true);
    expect(
      policy.canAccess(createAccess({ allDepartments: true }), ["backend"]),
    ).toBe(false);
    expect(
      policy.canAccess(
        createAccess({ isAdmin: true, mode: "admin", role: null }),
        ["backend"],
      ),
    ).toBe(true);
    expect(
      policy.canAccess(
        createAccess({ isActive: false, allProjects: true }),
        [],
      ),
    ).toBe(false);
  });
});
