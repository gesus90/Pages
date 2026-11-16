import { expect, it, vi } from "vitest";

import { McpUserReadService } from "@/backend/service/mcp/users/McpUserReadService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { McpUserSession } from "@/backend/service/mcp/users/McpUserSession";

function session(): McpUserSession {
  return partial<McpUserSession>({
    actor: { userId: "manager", isAdmin: false },
    isAdministrator: false,
    requireManagement: vi.fn(),
    rightsFingerprint: () => "rights",
    visibleRoles: () => [
      {
        id: "role",
        name: "Editor",
        rank: 2,
        departmentBound: false,
        permissions: [],
      },
      {
        id: "other",
        name: "Viewer",
        rank: 1,
        departmentBound: false,
        permissions: [],
      },
    ],
    visibleRole: (id: string) => ({
      id,
      name: "Editor",
      rank: 2,
      departmentBound: false,
      permissions: [],
    }),
    holders: () => ["visible", "hidden"],
    visibleIds: () => ["visible"],
    canEditRole: () => true,
    visibleDepartments: () => [{ id: "department", name: "Design" }],
    visibleDepartment: (id: string) => ({ id, name: "Design" }),
    departmentMembers: () => ["visible", "hidden"],
    policy: { canManageDepartment: () => true },
    visibleGroups: async () => [
      { id: "group", name: "Team", memberIds: ["visible", "hidden"] },
    ],
    visibleGroup: async (id: string) => ({
      id,
      name: "Team",
      memberIds: ["visible", "hidden"],
    }),
    groupMembers: () => ["visible", "hidden"],
    canChangeGroup: () => false,
  });
}

it("filters and projects visible roles without exposing hidden holders", () => {
  const service = new McpUserReadService();
  const actor = session();
  expect(service.roles(actor, { limit: 10, text: "edit" })).toMatchObject({
    total: 1,
    roles: [{ id: "role", holderIds: ["visible"] }],
  });
  expect(service.role(actor, "role")).toMatchObject({
    role: { id: "role", holderIds: ["visible"] },
  });
});

it("projects departments and groups through the visibility boundary", async () => {
  const service = new McpUserReadService();
  const actor = session();
  expect(service.departments(actor, { limit: 10 })).toMatchObject({
    total: 1,
    departments: [{ id: "department", memberIds: ["visible"] }],
  });
  expect(service.department(actor, "department")).toMatchObject({
    department: { memberIds: ["visible"] },
  });
  expect(
    await service.groups(actor, { limit: 10, text: "team" }),
  ).toMatchObject({
    total: 1,
    groups: [{ id: "group", memberIds: ["visible"], canEdit: false }],
  });
  expect(await service.group(actor, "group")).toMatchObject({
    group: { memberIds: ["visible"] },
  });
});
