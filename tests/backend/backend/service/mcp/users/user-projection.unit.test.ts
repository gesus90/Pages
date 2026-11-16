import { describe, expect, it, vi } from "vitest";

import {
  matchesMcpUserText,
  pageMcpUserList,
  projectMcpActivity,
  projectMcpUser,
} from "@/backend/service/mcp/users/McpUserProjection";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpUserSession } from "@/backend/service/mcp/users/McpUserSession";
import type { AdministrationActivity } from "@/definition/AgentAdministration";
import type { ManagedUser } from "@/definition/Authorization";
import type { UserGroup } from "@/definition/UserGroup";

const session = partial<McpUserSession>({
  actor: partial({ userId: "actor" }),
  rightsFingerprint: () => "rights",
  policy: partial({ canChange: vi.fn().mockReturnValue(true) }),
  isAdministrator: true,
});

describe("user administration projections", () => {
  it("matches names case-insensitively and binds pagination to rights", () => {
    expect(matchesMcpUserText(" ADA ", [null, "Ada Lovelace"])).toBe(true);
    expect(matchesMcpUserText("", [null])).toBe(true);
    expect(matchesMcpUserText("Grace", ["Ada"])).toBe(false);
    const page = pageMcpUserList([{ id: "a" }, { id: "b" }], {
      session,
      list: "users",
      request: { limit: 1 },
    });
    expect(page).toMatchObject({ entries: [{ id: "a" }], total: 2 });
    expect(() =>
      pageMcpUserList([{ id: "b" }], {
        session,
        list: "other",
        request: { limit: 50, cursor: page.nextCursor ?? "" },
      }),
    ).toThrow();
  });

  it("projects visible memberships and action permissions", () => {
    const user = partial<ManagedUser>({
      id: "u",
      username: "ada",
      displayName: "Ada",
      email: null,
      isActive: true,
      canEditProfile: true,
      canManageAccess: false,
      canManageMemberships: true,
      canManageScope: false,
      account: partial({
        firstName: "Ada",
        lastName: "L",
        isAdmin: false,
        role: null,
        departments: ["b", "a"],
        managedDepartments: [],
        allDepartments: false,
        allProjects: false,
      }),
    });
    const groups = [
      partial<UserGroup>({ id: "group", memberIds: ["u"] }),
      partial<UserGroup>({ id: "other", memberIds: [] }),
    ];
    expect(projectMcpUser(session, user, groups)).toMatchObject({
      id: "u",
      departmentIds: ["a", "b"],
      groupIds: ["group"],
      roleId: null,
      allowedActions: { canAssignRole: true, canSetAdministrator: true },
    });
  });

  it("filters malformed affected-user records", () => {
    const activity = partial<AdministrationActivity>({
      id: "id",
      changes: '{"affectedUserIds":["a",1,"b"]}',
    });
    expect(projectMcpActivity(activity).affectedUserIds).toEqual(["a", "b"]);
    for (const changes of ["bad", "null", "{}", '{"affectedUserIds":{}}'])
      expect(
        projectMcpActivity({ ...activity, changes }).affectedUserIds,
      ).toEqual([]);
  });
});
