import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentPlanScriptPreparation } from "@/backend/service/agents/AgentPlanScriptPreparation";
import {
  scriptApprovalHash,
  scriptApprovalState,
} from "@/backend/service/agents/AgentPlanScriptApproval";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlan, AgentPlanView } from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";
import type { AccountAccess } from "@/definition/Authorization";

vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  readSpawnScope: vi.fn(async () => ({})),
}));

const SCRIPT: AgentPlanScript = {
  id: "script-1",
  type: "script",
  name: "Prüfen",
  x: 0,
  y: 0,
  interpreterProfileId: "python",
  content: "print('ok')",
  inputs: [],
  outputs: [],
  timeoutSeconds: 60,
  bindings: {},
};

function planWith(script: AgentPlanScript): AgentPlan {
  return {
    id: "plan-1",
    name: "Pages Session 2",
    ownerId: "owner",
    projectId: "project",
    workspaceId: "workspace",
    usage: "private",
    revision: 1,
    globals: {},
    nodes: [script],
    edges: [],
  };
}

function account(userId: string, isAdmin: boolean): AccountAccess {
  return {
    userId,
    role: null,
    isAdmin,
    mode: isAdmin ? "admin" : "role",
    firstName: userId,
    lastName: "",
    isActive: true,
    departments: [],
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: true,
  };
}

/** A preparation whose plan is runnable by Mei through her team; approvals are given per test. */
function preparation(approvedHash: string | null): AgentPlanScriptPreparation {
  const plan = planWith(SCRIPT);
  const current: AgentPlanView = {
    ...plan,
    canEdit: true,
    projectName: "Pages",
    github: null,
    rights: {
      canRead: true,
      canEdit: true,
      canRun: true,
      canManageTeams: false,
      canChangeOwner: false,
      canDelete: false,
      isAdministrator: false,
      isAdminAccess: false,
    },
  };
  return new AgentPlanScriptPreparation({
    scripts: { executable: vi.fn(async () => partial({ id: "python" })) },
    workspaces: { resolve: vi.fn(async () => partial({ path: "/work" })) },
    access: { require: async () => current },
    authorization: {
      snapshot: async () =>
        partial({ accounts: [account("Mei", false), account("Igor", true)] }),
    },
    tasks: { snapshot: vi.fn() },
    approvals: {
      list: async () =>
        new Map(
          approvedHash === null
            ? []
            : [
                [
                  SCRIPT.id,
                  {
                    stepId: SCRIPT.id,
                    contentHash: approvedHash,
                    approvedBy: "Igor",
                    approvedAt: "2026-11-12T10:00:00.000Z",
                  },
                ],
              ],
        ),
    },
  });
}

describe("approval of script content (PAGE-329, part C)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("binds the hash to script, interpreter and workspace", () => {
    const plan = planWith(SCRIPT);
    const hash = scriptApprovalHash(plan, SCRIPT);
    expect(
      scriptApprovalHash(plan, { ...SCRIPT, content: "print(1)" }),
    ).not.toBe(hash);
    expect(
      scriptApprovalHash(plan, { ...SCRIPT, interpreterProfileId: "node" }),
    ).not.toBe(hash);
    expect(
      scriptApprovalHash({ ...plan, workspaceId: "other" }, SCRIPT),
    ).not.toBe(hash);
    const renamed: AgentPlanScript = { ...SCRIPT, name: "Umbenannt" };
    expect(scriptApprovalHash(plan, renamed)).toBe(hash);
  });

  it("lists a changed script as unapproved", () => {
    const approved = scriptApprovalHash(planWith(SCRIPT), SCRIPT);
    const changed = planWith({ ...SCRIPT, content: "print('anders')" });
    expect(
      scriptApprovalState(
        changed,
        new Map([[SCRIPT.id, { contentHash: approved }]]),
      ),
    ).toEqual({ hasScripts: true, unapprovedStepIds: [SCRIPT.id] });
  });

  it("lets Mei start an approved script and refuses her Play after she changed it", async () => {
    const approved = scriptApprovalHash(planWith(SCRIPT), SCRIPT);
    await expect(
      preparation(approved).validate("Mei", planWith(SCRIPT)),
    ).resolves.toBeUndefined();
    await expect(
      preparation(approved).validate(
        "Mei",
        planWith({ ...SCRIPT, content: "print('geändert')" }),
      ),
    ).rejects.toMatchObject({ code: "plan_script_approval_required" });
  });

  it("refuses a team member's Play while no administrator approved the script", async () => {
    await expect(
      preparation(null).validate("Mei", planWith(SCRIPT)),
    ).rejects.toMatchObject({ code: "plan_script_approval_required" });
  });

  it("lets an administrator start a script without an approval", async () => {
    await expect(
      preparation(null).validate("Igor", planWith(SCRIPT)),
    ).resolves.toBeUndefined();
  });
});
