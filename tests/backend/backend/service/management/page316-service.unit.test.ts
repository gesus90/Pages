import { describe, expect, it, vi } from "vitest";

import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";

import { managementFixture } from "./page316-service-fixture";

import type { Project, ProjectMember } from "@/definition/Project";

const OPERATION = "b5bd6b58-ffdf-44ea-bc89-ae9e4ac74e00";
const input = {
  kind: "human",
  displayName: "New Person",
  username: "new-person",
  email: "new@example.test",
  role: "role-employee",
  departmentIds: ["legal"],
  groupIds: [],
  operationId: OPERATION,
};

function revision(result: unknown): string {
  if (
    typeof result === "object" &&
    result !== null &&
    "revision" in result &&
    typeof result.revision === "string"
  )
    return result.revision;
  throw new Error("Missing revision");
}
function identity(result: unknown): string {
  if (
    typeof result === "object" &&
    result !== null &&
    "id" in result &&
    typeof result.id === "string"
  )
    return result.id;
  throw new Error("Missing ID");
}

describe("PAGE-316 production management service", () => {
  it("creates, reads, patches, filters and deactivates a person with no public credential", async () => {
    const { service, send, database } = managementFixture();
    const created = await service.call("management", "users_create", input);
    const id = identity(created);
    expect(send).toHaveBeenCalledOnce();
    expect(Object.keys(created).sort()).toEqual(["id", "revision"]);
    const read = await service.call("management", "users_read", { userId: id });
    expect(read).toMatchObject({
      id,
      kind: "human",
      status: "active",
      email: input.email,
      agent: null,
      departments: [{ id: "legal", name: "Legal" }],
    });
    const updated = await service.call("management", "users_update", {
      userId: id,
      expectedRevision: revision(read),
      displayName: "Updated",
      operationId: "d08f9373-a92e-4615-a87e-e6378756dafc",
    });
    const deactivated = await service.call("management", "users_set_status", {
      userId: id,
      expectedRevision: revision(updated),
      status: "deactivated",
    });
    expect(deactivated).toMatchObject({ id, status: "deactivated" });
    expect(
      await service.call("management", "users_list", {
        query: "Updated",
        status: "deactivated",
        kind: "human",
        departmentId: "legal",
      }),
    ).toMatchObject({
      total: 1,
      nextCursor: null,
      users: [{ id, displayName: "Updated" }],
    });
    expect(JSON.stringify([...database.receipts.values()])).not.toMatch(
      /temporaryPassword|passwordHash|invitation|token/iu,
    );
    expect(database.audited.length).toBeGreaterThanOrEqual(5);
    expect(
      database.audited.every((entry) => entry.actor_id === "management"),
    ).toBe(true);
  });

  it("replays an operation without a second account or mail and refuses changed input", async () => {
    const { service, send, world } = managementFixture();
    const first = await service.call("management", "users_create", input);
    expect(await service.call("management", "users_create", input)).toEqual(
      first,
    );
    expect(send).toHaveBeenCalledOnce();
    expect(
      [...world.store.users.values()].filter(
        (record) => record.user.username === input.username,
      ),
    ).toHaveLength(1);
    await expect(
      service.call("management", "users_create", {
        ...input,
        displayName: "Different",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses stale and protected writes before any mutation", async () => {
    const { service, world } = managementFixture();
    const read = await service.call("management", "users_read", {
      userId: "emp-sales",
    });
    await world.service().setActive("admin", "emp-sales", false);
    const writes = world.writes.length;
    await expect(
      service.call("management", "users_update", {
        userId: "emp-sales",
        expectedRevision: revision(read),
        displayName: "Stale",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { currentRevision: expect.any(String) },
    });
    expect(world.writes.length).toBe(writes);
    await expect(
      service.call("management", "users_set_status", {
        userId: "admin",
        expectedRevision: "stale",
        status: "deactivated",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { reason: "admin_target" },
    });
    await expect(
      service.call("management", "users_update", {
        userId: "management",
        expectedRevision: "stale",
        role: "role-employee",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      service.call("writer", "users_list", {}),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { reason: "core_system" },
    });
  });

  it("paginates without overlap and rejects a cursor used for another query", async () => {
    const { service } = managementFixture();
    const first = await service.call("management", "users_list", { limit: 2 });
    if (!("users" in first) || !first.nextCursor)
      throw new Error("Expected paged users");
    const second = await service.call("management", "users_list", {
      limit: 2,
      cursor: first.nextCursor,
    });
    if (!("users" in second)) throw new Error("Expected users");
    expect(
      second.users.some((user) =>
        first.users.some((entry) => entry.id === user.id),
      ),
    ).toBe(false);
    await expect(
      service.call("management", "users_list", {
        limit: 2,
        cursor: first.nextCursor,
        kind: "agent",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("creates and patches group description, members and leadership with revision protection", async () => {
    const { service } = managementFixture();
    const created = await service.call("management", "groups_create", {
      name: "Team",
      description: "First",
      memberIds: ["emp-sales", "emp-legal"],
      leaderIds: ["emp-sales"],
      operationId: OPERATION,
    });
    const groupId = identity(created);
    const changed = await service.call("management", "groups_update", {
      groupId,
      expectedRevision: revision(created),
      description: "Changed",
      leaderIds: ["emp-legal"],
    });
    expect(
      await service.call("management", "groups_read", { groupId }),
    ).toMatchObject({ description: "Changed", leaderIds: ["emp-legal"] });
    await expect(
      service.call("management", "groups_update", {
        groupId,
        expectedRevision: revision(created),
        name: "Stale",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { currentRevision: revision(changed) },
    });
  });

  it("replaces project members/roles and departments and enforces catalog minimums", async () => {
    const { service, world } = managementFixture();
    let project: Project = {
      id: "project",
      name: "Project",
      description: "",
      departments: [{ id: "sales", name: "Sales" }],
      parentId: null,
      status: "active",
      progress: 0,
      placeholderColor: "",
      hasIcon: false,
      managerId: null,
      managerName: null,
      startDate: null,
      targetDate: null,
      notes: "",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const members: ProjectMember[] = [];
    vi.spyOn(ProjectRepository.prototype, "findById").mockImplementation(
      async () => project,
    );
    vi.spyOn(ProjectRepository.prototype, "findMembers").mockImplementation(
      async () => [...members],
    );
    vi.spyOn(ProjectRepository.prototype, "isProjectManager").mockResolvedValue(
      false,
    );
    vi.spyOn(ProjectRepository.prototype, "addMember").mockImplementation(
      async (_projectId, userId, role) => {
        members.push({
          userId,
          username: userId,
          displayName: userId,
          projectRole: role,
          joinedAt: "2026-01-01T00:00:00Z",
          isActive: true,
          avatarType: "initials",
          avatarIcon: null,
          avatarColor: null,
          avatarImageUrl: null,
        });
      },
    );
    vi.spyOn(ProjectRepository.prototype, "setDepartments").mockImplementation(
      async (_projectId, ids) => {
        project = {
          ...project,
          departments: world.store.departments.filter((department) =>
            ids.includes(department.id),
          ),
        };
      },
    );
    const current = await service.projectRevision("management", "project");
    const changed = await service.call("management", "project_members_set", {
      projectId: "project",
      expectedRevision: current,
      members: [{ userId: "emp-legal", role: "projectmanager" }],
    });
    expect(members[0]?.projectRole).toBe("manager");
    const departments = await service.call(
      "management",
      "projects_set_departments",
      {
        projectId: "project",
        expectedRevision: revision(changed),
        departmentIds: ["legal"],
      },
    );
    expect(project.departments.map((department) => department.id)).toEqual([
      "legal",
    ]);
    await expect(
      service.call("management", "projects_set_departments", {
        projectId: "project",
        expectedRevision: revision(departments),
        departmentIds: [],
      }),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      details: { reason: "department_required" },
    });
  });
});

it("keeps the audit view exclusive to administrators", async () => {
  const { service } = managementFixture();
  await expect(service.audit.list("management")).rejects.toMatchObject({
    code: "FORBIDDEN",
    details: { reason: "core_system" },
  });
  expect(await service.audit.list("admin")).toEqual([]);
});
