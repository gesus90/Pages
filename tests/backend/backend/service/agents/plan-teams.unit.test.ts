import { describe, expect, it, vi } from "vitest";

import { AgentPlanSharing } from "@/backend/service/agents/AgentPlanSharing";
import { AgentPlanTeamService } from "@/backend/service/agents/AgentPlanTeamService";
import { readPlanTeamsParameter } from "@/backend/service/agents/AgentPlanTeamInput";
import { normalizePlanTeams } from "@/definition/AgentPlanTeam";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentPlanRights } from "@/backend/service/agents/AgentPlanSharing";
import type { AgentPlanView } from "@/definition/AgentPlan";
import type { AgentPlanRightsView } from "@/definition/AgentPlanTeam";
import type { AccountAccess } from "@/definition/Authorization";

const A_TEAM = "group-a-team";
const DEVELOPMENT = "department-development";
const OWNER = "f11d6262-owner";

function account(
  userId: string,
  overrides: Partial<AccountAccess> = {},
): AccountAccess {
  return {
    userId,
    role: {
      id: "developer",
      name: "Software-Entwickler",
      rank: 10,
      departmentBound: false,
      permissions: [],
    },
    isAdmin: false,
    mode: "role",
    firstName: userId,
    lastName: "",
    isActive: true,
    departments: [],
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: true,
    ...overrides,
  };
}

function viewer(
  actor: AccountAccess,
  groupIds: readonly string[] = [],
): AgentViewer {
  return { actor, groupIds };
}

function plan(overrides: Partial<AgentPlanRights> = {}): AgentPlanRights {
  return {
    ownerId: OWNER,
    departmentId: null,
    usage: "private",
    teams: [],
    ...overrides,
  };
}

const SHARING = new AgentPlanSharing(partial({}), partial({}));

const A_TEAM_EDIT_RUN = plan({
  teams: [
    {
      kind: "group",
      targetId: A_TEAM,
      canRead: true,
      canEdit: true,
      canRun: true,
    },
  ],
});

describe("the rights a team gives on a plan (PAGE-329)", () => {
  it.each([
    ["Ed", { departments: [DEVELOPMENT] }],
    ["Mei", { departments: ["department-quality"] }],
    ["Conan", { departments: ["department-documentation"] }],
    ["Bakuman", { departments: ["department-design"] }],
    ["All Might", { departments: [DEVELOPMENT, "department-lead"] }],
  ])(
    "lets %s, a member of the A-Team, change and run the plan",
    (name, overrides) => {
      const rights = SHARING.rights(
        A_TEAM_EDIT_RUN,
        viewer(account(name, overrides), [A_TEAM]),
      );
      expect(rights).toMatchObject({
        canRead: true,
        canEdit: true,
        canRun: true,
        canDelete: false,
        isAdminAccess: false,
      });
    },
  );

  it("gives a member whose team only reads neither change nor run", () => {
    const readOnly = plan({
      teams: [
        {
          kind: "department",
          targetId: DEVELOPMENT,
          canRead: true,
          canEdit: false,
          canRun: false,
        },
      ],
    });
    const rights = SHARING.rights(
      readOnly,
      viewer(account("Mei", { departments: [DEVELOPMENT] })),
    );
    expect(rights).toMatchObject({
      canRead: true,
      canEdit: false,
      canRun: false,
    });
  });

  it("hides the plan from a non-member unless a share lets them read it", () => {
    const outsider = viewer(account("Stranger"), ["group-other"]);
    expect(SHARING.rights(A_TEAM_EDIT_RUN, outsider).canRead).toBe(false);
    const shared = { ...A_TEAM_EDIT_RUN, usage: "workspace" as const };
    expect(SHARING.rights(shared, outsider)).toMatchObject({
      canRead: true,
      canEdit: false,
      canRun: false,
    });
  });

  it("keeps the legacy department of a plan read without its team list", () => {
    const legacy = plan({ departmentId: DEVELOPMENT, teams: undefined });
    expect(
      SHARING.rights(
        legacy,
        viewer(account("Ed", { departments: [DEVELOPMENT] })),
      ),
    ).toMatchObject({ canRead: true, canEdit: true, canRun: true });
  });

  it("joins the rights of several teams of the same person", () => {
    const split = plan({
      teams: [
        {
          kind: "group",
          targetId: A_TEAM,
          canRead: true,
          canEdit: true,
          canRun: false,
        },
        {
          kind: "department",
          targetId: DEVELOPMENT,
          canRead: true,
          canEdit: false,
          canRun: true,
        },
      ],
    });
    expect(
      SHARING.rights(
        split,
        viewer(account("Ed", { departments: [DEVELOPMENT] }), [A_TEAM]),
      ),
    ).toMatchObject({ canEdit: true, canRun: true });
  });
});

describe("the rights of administrators on every plan (PAGE-329, part E)", () => {
  const igor = account("Igor", { isAdmin: true, mode: "admin" });

  it("gives an active administrator every right on a plan of somebody else without a team", () => {
    expect(SHARING.rights(plan(), viewer(igor))).toEqual({
      canRead: true,
      canEdit: true,
      canRun: true,
      canChangeOwner: true,
      canDelete: true,
      isAdministrator: true,
      isAdminAccess: true,
    });
  });

  it("gives a second administrator the same rights on the plan of the first", () => {
    const other = plan({ ownerId: "admin-two" });
    expect(SHARING.rights(other, viewer(igor)).canDelete).toBe(true);
  });

  it("marks no admin access on the administrator's own plan", () => {
    expect(
      SHARING.rights(plan({ ownerId: "Igor" }), viewer(igor)).isAdminAccess,
    ).toBe(false);
  });

  it("never gives an agent account administrator rights, whatever is stored", () => {
    const agent = account("All Might", {
      isAdmin: true,
      mode: "admin",
      isAgent: true,
    });
    expect(SHARING.rights(plan(), viewer(agent))).toMatchObject({
      canRead: false,
      canEdit: false,
      canRun: false,
      isAdministrator: false,
    });
  });

  it("asks for the administrator mode on the interface but not over MCP", () => {
    const roleMode = account("Igor", { isAdmin: true, mode: "role" });
    expect(SHARING.rights(plan(), viewer(roleMode)).canEdit).toBe(false);
    expect(
      SHARING.forChannel("mcp").rights(plan(), viewer(roleMode)).canEdit,
    ).toBe(true);
  });
});

function rights(overrides: Partial<AgentPlanRightsView>): AgentPlanRightsView {
  return {
    canRead: true,
    canEdit: true,
    canRun: true,
    canManageTeams: false,
    canChangeOwner: false,
    canDelete: false,
    isAdministrator: false,
    isAdminAccess: false,
    ...overrides,
  };
}

function view(overrides: Partial<AgentPlanView> = {}): AgentPlanView {
  return {
    id: "plan-1",
    name: "Pages Session 1",
    ownerId: OWNER,
    projectId: "project",
    workspaceId: "workspace",
    usage: "private",
    revision: 4,
    globals: {},
    nodes: [],
    edges: [],
    teams: [],
    canEdit: true,
    projectName: "Pages",
    github: null,
    rights: rights({}),
    ...overrides,
  };
}

function teamService(current: AgentPlanView): {
  readonly service: AgentPlanTeamService;
  readonly change: ReturnType<typeof vi.fn>;
  readonly record: ReturnType<typeof vi.fn>;
  readonly validateTeams: ReturnType<typeof vi.fn>;
} {
  const change = vi.fn(async () => current.revision + 1);
  const record = vi.fn(async () => undefined);
  const validateTeams = vi.fn(async () => undefined);
  const service = new AgentPlanTeamService({
    access: {
      require: async () => current,
      validateTeams,
      team: async () => ({
        projectId: null,
        departmentIds: [],
        departmentId: null,
      }),
    },
    accessChanges: partial({ change, record, approveScripts: vi.fn() }),
  });
  return { service, change, record, validateTeams };
}

const A_TEAM_ENTRY = {
  kind: "group" as const,
  targetId: A_TEAM,
  canRead: false,
  canEdit: true,
  canRun: true,
};

describe("changing teams and owner of a plan (PAGE-329, part B)", () => {
  it("lets an administrator give the orphaned Session plans a team, as its own revision", async () => {
    const world = teamService(
      view({ rights: rights({ canManageTeams: true, isAdministrator: true }) }),
    );
    await expect(
      world.service.change("Igor", "plan-1", {
        revision: 4,
        teams: [A_TEAM_ENTRY],
      }),
    ).resolves.toBe(5);
    expect(world.validateTeams).toHaveBeenCalledWith([
      { ...A_TEAM_ENTRY, canRead: true },
    ]);
    expect(world.change).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "plan-1",
        revision: 4,
        actorId: "Igor",
        teams: [{ ...A_TEAM_ENTRY, canRead: true }],
      }),
    );
  });

  it("refuses teams from a team member who neither owns nor manages the plan", async () => {
    const world = teamService(view());
    await expect(
      world.service.change("Mei", "plan-1", {
        revision: 4,
        teams: [A_TEAM_ENTRY],
      }),
    ).rejects.toMatchObject({ code: "plan_team_forbidden" });
    expect(world.change).not.toHaveBeenCalled();
  });

  it("refuses an owner change by anybody but an administrator", async () => {
    const world = teamService(
      view({ rights: rights({ canManageTeams: true }) }),
    );
    await expect(
      world.service.change("Ed", "plan-1", { revision: 4, ownerId: "Ed" }),
    ).rejects.toMatchObject({ code: "plan_owner_forbidden" });
  });

  it("refuses a stale revision before writing", async () => {
    const world = teamService(
      view({ rights: rights({ canManageTeams: true, canChangeOwner: true }) }),
    );
    await expect(
      world.service.change("Igor", "plan-1", { revision: 3, ownerId: "Igor" }),
    ).rejects.toMatchObject({ code: "plan_conflict" });
    expect(world.change).not.toHaveBeenCalled();
  });

  it("records an administrator action on a plan of somebody else, never on an own plan", async () => {
    const foreign = teamService(
      view({ rights: rights({ isAdministrator: true, isAdminAccess: true }) }),
    );
    await foreign.service.recordAdminAction(
      "Igor",
      view({ rights: rights({ isAdminAccess: true }) }),
      "admin_deleted",
    );
    expect(foreign.record).toHaveBeenCalledWith({
      planId: "plan-1",
      actorId: "Igor",
      action: "admin_deleted",
      revision: 4,
      details: { planName: "Pages Session 1" },
    });
    const own = teamService(view());
    await own.service.recordAdminAction("Igor", view(), "admin_saved");
    expect(own.record).not.toHaveBeenCalled();
  });
});

describe("reading teams from update_plan", () => {
  it("defaults every omitted right to true and keeps the order", () => {
    expect(
      readPlanTeamsParameter([
        { kind: "group", id: A_TEAM },
        { kind: "department", id: DEVELOPMENT, edit: false, run: false },
      ]),
    ).toEqual([
      {
        kind: "group",
        targetId: A_TEAM,
        canRead: true,
        canEdit: true,
        canRun: true,
      },
      {
        kind: "department",
        targetId: DEVELOPMENT,
        canRead: true,
        canEdit: false,
        canRun: false,
      },
    ]);
  });

  it("refuses an unknown kind or field", () => {
    expect(() =>
      readPlanTeamsParameter([{ kind: "person", id: "x" }]),
    ).toThrow();
    expect(() =>
      readPlanTeamsParameter([{ kind: "group", id: "x", admin: true }]),
    ).toThrow();
  });

  it("stores each target once and drops entries without any right", () => {
    expect(
      normalizePlanTeams([
        A_TEAM_ENTRY,
        { ...A_TEAM_ENTRY, canEdit: false },
        {
          kind: "department",
          targetId: DEVELOPMENT,
          canRead: false,
          canEdit: false,
          canRun: false,
        },
      ]),
    ).toEqual([{ ...A_TEAM_ENTRY, canRead: true }]);
  });
});
