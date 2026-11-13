import { describe, expect, it, vi } from "vitest";

import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { ProjectPolicyService } from "@/backend/auth/ProjectPolicyService";
import { TicketDepartmentPolicy } from "@/backend/auth/TicketDepartmentPolicy";
import { GroupAdministrationService } from "@/backend/service/GroupAdministrationService";
import {
  requireManagementTarget,
  requireManagementRole,
} from "@/backend/service/management/ManagementPolicy";
import { ADMINISTRATION_ROLE_ID, CAPABILITY } from "@/definition/Authorization";

import { organizationWorld } from "../accounts/administration-directory";
import { accountFixture } from "../../auth/account-fixture";

function worldWithManagement(): ReturnType<typeof organizationWorld> {
  const world = organizationWorld();
  world.addAccount({
    userId: "management",
    roleId: ADMINISTRATION_ROLE_ID,
    rank: 1000000,
    departmentBound: false,
    permissions: [
      CAPABILITY.WRITE,
      CAPABILITY.MANAGE_USERS,
      CAPABILITY.MANAGE_PROJECTS,
      CAPABILITY.MILESTONES,
    ],
  });
  return world;
}

describe("PAGE-316 protected role", () => {
  it("lets only an administrator grant and revoke the built-in role", async () => {
    const world = worldWithManagement();
    await world
      .service()
      .assignRole("admin", "emp-sales", ADMINISTRATION_ROLE_ID);
    expect(world.account("emp-sales").role?.id).toBe(ADMINISTRATION_ROLE_ID);
    await expect(
      world.service().assignRole("hr", "loose", ADMINISTRATION_ROLE_ID),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { reason: "role_grant" },
    });
    await expect(
      world.service().assignRole("management", "emp-sales", "role-employee"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { reason: "role_grant" },
    });
    await world.service().assignRole("admin", "emp-sales", "role-employee");
    expect(world.account("emp-sales").role?.id).toBe("role-employee");
  });

  it("does not turn a role named Verwaltung into the protected role", () => {
    const actor = accountFixture();
    expect(
      new UserPolicyService().isManagement({
        ...actor,
        role: actor.role ? { ...actor.role, name: "Verwaltung" } : null,
      }),
    ).toBe(false);
  });

  it("provides global business access without granting core-system administration", () => {
    const actor = worldWithManagement().account("management");
    const users = new UserPolicyService();
    expect(users.canEnter(actor)).toBe(true);
    expect(users.isAdministrator(actor)).toBe(false);
    expect(users.has(actor, CAPABILITY.MANAGE_ROLES)).toBe(false);
    expect(users.has(actor, CAPABILITY.MANAGE_DEPARTMENTS)).toBe(false);
    const projects = new ProjectPolicyService();
    expect(projects.canAccess(actor, ["foreign"])).toBe(true);
    expect(
      projects.canCreate(actor, {
        hasDepartments: true,
        departmentIds: ["foreign"],
      }),
    ).toBe(true);
    expect(
      projects.canEditGeneral(actor, {
        departmentIds: ["foreign"],
        isProjectManager: false,
      }),
    ).toBe(true);
    expect(
      projects.canChangeDepartments(actor, ["a"], {
        hasDepartments: true,
        departmentIds: ["b"],
      }),
    ).toBe(true);
    expect(projects.canDelete(actor)).toBe(false);
    expect(new TicketDepartmentPolicy().canSelect(actor, "foreign")).toBe(true);
  });

  it("changes and deactivates people across departments", async () => {
    const world = worldWithManagement();
    await world.service().updateProfile("management", "emp-legal", {
      username: "legal",
      firstName: "Legal",
      lastName: "Person",
      email: "legal@example.test",
    });
    await world.service().setMemberships("management", "emp-legal", ["sales"]);
    await world.service().setActive("management", "emp-legal", false);
    expect(world.user("emp-legal").displayName).toBe("Legal Person");
    expect(world.account("emp-legal").departments).toEqual(["sales"]);
    expect(world.user("emp-legal").isActive).toBe(false);
  });

  it("delivers human credentials only to the replaceable email boundary", async () => {
    const world = worldWithManagement();
    const send = vi.fn().mockResolvedValue(undefined);
    const response = await world.service().createUser(
      "management",
      {
        username: "new-person",
        firstName: "New Person",
        lastName: "",
        email: "person@example.test",
        roleId: "role-employee",
        isAdmin: false,
        departments: ["legal"],
      },
      { send },
    );
    expect(response).toEqual({ temporaryPassword: "" });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "person@example.test",
        username: "new-person",
        temporaryPassword: expect.stringMatching(/^[A-Za-z2-9-]+$/u),
      }),
    );
    expect(world.findByUsername("new-person")?.mustChangePassword).toBe(true);
    await expect(
      world.service().createUser("management", {
        username: "no-delivery",
        firstName: "No",
        lastName: "Delivery",
        email: "none@example.test",
        roleId: "role-employee",
        isAdmin: false,
        departments: [],
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { reason: "core_system" },
    });
  });

  it.each(["reset", "scope", "admin"])(
    "rejects the legacy %s credential or privilege path",
    async (operation) => {
      const world = worldWithManagement();
      const service = world.service();
      let pending: Promise<unknown>;
      switch (operation) {
        case "reset":
          pending = service.resetPassword("management", "emp-sales");
          break;
        case "scope":
          pending = service.setScope("management", "emp-sales", {
            allDepartments: true,
            allProjects: true,
            managedDepartments: [],
          });
          break;
        default:
          pending = service.setAdministrator("management", "emp-sales", true);
      }
      await expect(pending).rejects.toMatchObject({
        code: "FORBIDDEN",
        details: {
          reason: operation === "reset" ? "core_system" : "role_grant",
        },
      });
    },
  );

  it("rejects administrator targets and changes of own rights with specific reasons", () => {
    const world = worldWithManagement();
    const actor = world.account("management");
    expect(() =>
      requireManagementTarget(actor, world.account("admin")),
    ).toThrow(
      expect.objectContaining({
        code: "FORBIDDEN",
        details: { reason: "admin_target" },
      }),
    );
    expect(() => requireManagementTarget(actor, actor)).toThrow(
      expect.objectContaining({
        code: "FORBIDDEN",
        details: { reason: "self_escalation" },
      }),
    );
    expect(() => requireManagementRole(actor, "admin")).toThrow(
      expect.objectContaining({ details: { reason: "role_grant" } }),
    );
  });

  it("manages group members and leaders but cannot change own or administrator membership", async () => {
    const world = worldWithManagement();
    const groups = new GroupAdministrationService(
      world.repository,
      world.cache,
    );
    await groups.saveGroup("management", {
      id: "team",
      name: "Team",
      memberIds: ["emp-sales", "emp-legal"],
      leaderIds: ["emp-legal"],
    });
    expect((await groups.pageData("management")).canSetLeaders).toBe(true);
    expect(world.store.groups[0]?.leaderIds).toEqual(["emp-legal"]);
    await expect(
      groups.saveGroup("management", {
        id: "team",
        name: "Team",
        memberIds: ["management"],
        leaderIds: [],
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { reason: "self_escalation" },
    });
    await expect(
      groups.saveGroup("management", {
        id: "team",
        name: "Team",
        memberIds: ["admin"],
        leaderIds: [],
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { reason: "admin_target" },
    });
  });
});

it("reads and edits every plan without inheriting its run or administrator controls", async () => {
  const { AgentPlanSharing } =
    await import("@/backend/service/agents/AgentPlanSharing");
  const world = worldWithManagement();
  const sharing = new AgentPlanSharing(
    world.repository,
    world.repository.groups(),
  );
  const viewer = { actor: world.account("management"), groupIds: [] };
  const plan = {
    ownerId: "emp-sales",
    departmentId: "sales",
    teams: [],
    usage: "private" as const,
  };
  expect(sharing.rights(plan, viewer)).toMatchObject({
    canRead: true,
    canEdit: true,
    canReadAllRuns: true,
    canRun: false,
    canDelete: false,
    isAdministrator: false,
  });
  expect(
    sharing.rights({ ...plan, ownerId: "management" }, viewer),
  ).toMatchObject({ canReadAllRuns: true, canRun: true });
});

it("refuses agent deletion for the protected role before any inventory or file operation", async () => {
  const { AgentDeletionService } =
    await import("@/backend/service/employee/AgentDeletionService");
  const world = worldWithManagement();
  const account = world.addAccount({ userId: "agent-target" });
  world.store.accounts.set(account.userId, { ...account, isAgent: true });
  const deletions = new AgentDeletionService({
    authorization: world.repository,
    cache: world.cache,
  });
  await expect(
    deletions.preview("management", "agent-target"),
  ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "core_system" });
  expect(world.writes).toEqual([]);
});

it("also refuses the personal password-setting boundary for Management", async () => {
  const { UserService } = await import("@/backend/service/UserService");
  const { PermissionService } =
    await import("@/backend/auth/PermissionService");
  const world = worldWithManagement();
  const users = new UserService(
    world.repository.users(),
    new PermissionService((id) => world.service().getContext(id)),
    world.service(),
  );
  await expect(
    users.updatePasswordHash("management", "replacement-hash"),
  ).rejects.toMatchObject({
    code: "FORBIDDEN",
    details: { reason: "core_system" },
  });
  expect(world.writes).toEqual([]);
});

it("reads and edits every wiki area without turning the account into a core administrator", async () => {
  const { WikiAccess, describePermissions } =
    await import("@/backend/service/wiki/WikiAccess");
  const { PermissionService } =
    await import("@/backend/auth/PermissionService");
  const world = worldWithManagement();
  const access = new WikiAccess(
    {
      workItemVisibility: async () => ({
        departmentIds: null,
        projectIds: ["foreign-project"],
      }),
    },
    new PermissionService((id) => world.service().getContext(id)),
  );
  const viewer = await access.resolve(world.user("management"));
  expect(viewer.scope.canReadPrivate).toBe(true);
  expect(viewer.scope.projectIds).toEqual(["foreign-project"]);
  expect(
    describePermissions(viewer, {
      scope: "private",
      ownerId: "another-account",
    }).canEdit,
  ).toBe(true);
  expect(
    new UserPolicyService().isAdministrator(world.account("management")),
  ).toBe(false);
});

it("rejects entering administrator mode without personal eligibility", async () => {
  const world = worldWithManagement();
  await expect(
    world.service().setMode("management", "admin"),
  ).rejects.toMatchObject({
    code: "FORBIDDEN",
    details: { reason: "self_escalation" },
  });
});
