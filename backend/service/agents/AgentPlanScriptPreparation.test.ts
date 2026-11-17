import { describe, expect, it, vi } from "vitest";

import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { AgentError } from "@/backend/error/AgentErrors";
import { emptyAgentPlan } from "@/definition/AgentPlan";

import { AgentPlanScriptPreparation } from "./AgentPlanScriptPreparation";
import { AgentPlanSharing } from "./AgentPlanSharing";
import { AgentPlanTeamService } from "./AgentPlanTeamService";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentPlanView } from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";
import type { AgentPlanTeam } from "@/definition/AgentPlanTeam";
import type { ResolvedAgentWorkspace } from "@/definition/AgentWorkspace";
import type { InterpreterProfile } from "@/definition/InterpreterProfile";
import type { Mock } from "vitest";

type PreparationDependencies = ConstructorParameters<
  typeof AgentPlanScriptPreparation
>[0];

interface ScriptFixture {
  readonly actor: AccountAccess;
  readonly plan: AgentPlanView;
  readonly workspace: ResolvedAgentWorkspace;
  readonly interpreter: InterpreterProfile;
  readonly service: AgentPlanScriptPreparation;
  readonly dependencies: PreparationDependencies;
  readonly resolve: Mock<PreparationDependencies["workspaces"]["resolve"]>;
  readonly executable: Mock<PreparationDependencies["scripts"]["executable"]>;
  readonly requirePlan: Mock<PreparationDependencies["access"]["require"]>;
  readonly snapshot: Mock<PreparationDependencies["authorization"]["snapshot"]>;
}

function actorFixture(overrides: Partial<AccountAccess> = {}): AccountAccess {
  return {
    userId: "owner",
    role: null,
    isAdmin: false,
    mode: "role",
    firstName: "Test",
    lastName: "Executor",
    isActive: true,
    departments: [],
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: false,
    ...overrides,
  };
}

function scriptFixture(
  overrides: Partial<AgentPlanScript> = {},
): AgentPlanScript {
  return {
    id: "script",
    type: "script",
    name: "Collect results",
    interpreterProfileId: "bash",
    content: "printf 'ready'",
    inputs: [{ name: "message", type: "text", isRequired: true }],
    outputs: [{ name: "result", type: "text" }],
    timeoutSeconds: 60,
    bindings: {
      message: { kind: "literal", value: { type: "text", text: "hello" } },
    },
    x: 0,
    y: 0,
    ...overrides,
  };
}

function planFixture(script: AgentPlanScript = scriptFixture()): AgentPlanView {
  return {
    ...emptyAgentPlan(),
    id: "plan",
    ownerId: "owner",
    projectId: "project",
    workspaceId: "workspace",
    revision: 7,
    nodes: [script],
    canEdit: true,
    projectName: "Project",
    github: null,
  };
}

function sharingFixture(): AgentPlanSharing {
  const transaction: DatabaseTransaction = {
    query: async () => {
      throw new Error("Unexpected database read");
    },
    execute: async () => {
      throw new Error("Unexpected database write");
    },
  };
  const transact = async <Result>(
    work: (connection: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work(transaction);
  const database = {
    ...transaction,
    transaction: transact,
    readTransaction: transact,
  };
  return new AgentPlanSharing(
    new AuthorizationRepository(database),
    new UserGroupRepository(database),
  );
}

function fixture(
  options: {
    readonly actor?: Partial<AccountAccess>;
    readonly teams?: readonly AgentPlanTeam[];
    readonly groupIds?: readonly string[];
  } = {},
): ScriptFixture {
  const actor = actorFixture(options.actor);
  const source = { ...planFixture(), teams: options.teams ?? [] };
  const shared = sharingFixture().rights(source, {
    actor,
    groupIds: options.groupIds ?? [],
  });
  const plan = {
    ...source,
    canEdit: shared.canEdit,
    rights: { ...shared, canManageTeams: actor.userId === source.ownerId },
  };
  const workspace: ResolvedAgentWorkspace = {
    id: plan.workspaceId,
    path: "/fixture/workspace",
    directoryIdentity: "device:inode",
    revision: 1,
    projectId: plan.projectId,
    github: null,
  };
  const interpreter = { id: "bash", name: "Bash", path: "/bin/bash" };
  const requirePlan = vi.fn<PreparationDependencies["access"]["require"]>(
    async () => plan,
  );
  const resolve = vi.fn<PreparationDependencies["workspaces"]["resolve"]>(
    async () => workspace,
  );
  const executable = vi.fn<PreparationDependencies["scripts"]["executable"]>(
    async () => interpreter,
  );
  const snapshot = vi.fn<PreparationDependencies["authorization"]["snapshot"]>(
    async () => ({ roles: [], departments: [], accounts: [actor] }),
  );
  const dependencies: PreparationDependencies = {
    access: { require: requirePlan },
    workspaces: { resolve },
    scripts: { executable },
    authorization: { snapshot },
    tasks: {
      snapshot: async (userId, projectId, id) => ({
        id,
        markdown: "ticket",
        version: "1",
      }),
    },
  };
  return {
    actor,
    plan,
    workspace,
    interpreter,
    service: new AgentPlanScriptPreparation(dependencies),
    dependencies,
    resolve,
    executable,
    requirePlan,
    snapshot,
  };
}

const RUN_TEAM: AgentPlanTeam = {
  kind: "group",
  targetId: "runners",
  canRead: true,
  canEdit: false,
  canRun: true,
};

describe("script execution under regular plan rights", () => {
  it.each([
    { name: "owner", options: {} },
    {
      name: "run-only group member",
      options: {
        actor: { userId: "member" },
        teams: [RUN_TEAM],
        groupIds: ["runners"],
      },
    },
    {
      name: "run-only agent",
      options: {
        actor: { userId: "agent", isAgent: true },
        teams: [RUN_TEAM],
        groupIds: ["runners"],
      },
    },
    {
      name: "department leader",
      options: {
        actor: { userId: "leader", departments: ["development"] },
        teams: [
          { ...RUN_TEAM, kind: "department" as const, targetId: "development" },
        ],
      },
    },
  ])(
    "prepares and dispatches scripts for a non-admin $name without approval storage",
    async ({ options }) => {
      const context = fixture(options);
      expect(context.plan.rights?.canRun).toBe(true);
      expect(context.plan.rights?.isAdministrator).toBe(false);
      await context.service.validate(context.actor.userId, context.plan);
      const snapshots = await context.service.prepare(
        context.actor.userId,
        context.plan,
        [],
      );
      expect(snapshots).toHaveLength(1);
      const script = snapshots[0];
      if (!script) throw new Error("Missing script snapshot");
      expect(script.inputs).toEqual({ message: "hello" });
      expect(script.interpreter).toEqual(context.interpreter);
      await context.service.reauthorize(
        context.actor.userId,
        context.plan,
        script,
      );
      expect(context.requirePlan).toHaveBeenLastCalledWith(
        context.actor.userId,
        context.plan.id,
      );
      expect(context.resolve).toHaveBeenLastCalledWith(
        context.actor.userId,
        context.plan.workspaceId,
        context.plan.projectId,
      );
    },
  );

  it("accepts edited content, interpreter and workspace as a new authorized preparation", async () => {
    const context = fixture();
    const plan = {
      ...context.plan,
      workspaceId: "another-workspace",
      revision: 8,
      nodes: [
        scriptFixture({
          content: "print('changed')",
          interpreterProfileId: "python",
        }),
      ],
    };
    context.requirePlan.mockResolvedValue(plan);
    context.resolve.mockResolvedValue({
      ...context.workspace,
      id: plan.workspaceId,
      path: "/fixture/another",
    });
    context.executable.mockResolvedValue({
      id: "python",
      name: "Python",
      path: "/usr/bin/python3",
    });
    await context.service.validate(context.actor.userId, plan);
    const snapshots = await context.service.prepare(
      context.actor.userId,
      plan,
      [],
    );
    expect(snapshots[0]?.step.content).toBe("print('changed')");
    expect(snapshots[0]?.workspace.id).toBe(plan.workspaceId);
    expect(snapshots[0]?.interpreter.id).toBe("python");
  });
});

describe("script preparation refusals", () => {
  it.each([
    {
      name: "reader",
      options: {
        actor: { userId: "reader" },
        teams: [{ ...RUN_TEAM, canRun: false }],
        groupIds: ["runners"],
      },
    },
    {
      name: "editor without execution",
      options: {
        actor: { userId: "editor" },
        teams: [{ ...RUN_TEAM, canEdit: true, canRun: false }],
        groupIds: ["runners"],
      },
    },
    {
      name: "non-member",
      options: { actor: { userId: "stranger" }, teams: [RUN_TEAM] },
    },
  ])("refuses a $name before resolving a workspace", async ({ options }) => {
    const context = fixture(options);
    await expect(
      context.service.validate(context.actor.userId, context.plan),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
    await expect(
      context.service.prepare(context.actor.userId, context.plan, []),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
    expect(context.resolve).not.toHaveBeenCalled();
  });

  it.each([
    { accounts: [] },
    { accounts: [actorFixture({ isActive: false })] },
  ])("refuses an inactive or missing executor", async ({ accounts }) => {
    const context = fixture();
    context.snapshot.mockResolvedValue({
      roles: [],
      departments: [],
      accounts,
    });
    await expect(
      context.service.validate("owner", context.plan),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
    expect(context.requirePlan).not.toHaveBeenCalled();
  });

  it("preserves project and workspace access refusals", async () => {
    const context = fixture();
    context.resolve.mockRejectedValue(new AgentError("plan_access_denied"));
    await expect(
      context.service.validate("owner", context.plan),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
    expect(context.executable).not.toHaveBeenCalled();
  });

  it.each([
    "plan_script_profile_missing",
    "plan_script_interpreter_unavailable",
  ] as const)("preserves the interpreter refusal %s", async (code) => {
    const context = fixture();
    context.executable.mockRejectedValue(new AgentError(code));
    await expect(
      context.service.validate("owner", context.plan),
    ).rejects.toMatchObject({ code });
    await expect(
      context.service.prepare("owner", context.plan, []),
    ).rejects.toMatchObject({ code });
  });

  it("still rejects invalid script configuration", async () => {
    const context = fixture();
    await expect(
      context.service.validate("owner", {
        ...context.plan,
        nodes: [scriptFixture({ timeoutSeconds: 0 })],
      }),
    ).rejects.toMatchObject({ code: "plan_script_invalid" });
  });

  it.each(["projectId", "workspaceId"] as const)(
    "refuses a changed plan %s",
    async (field) => {
      const context = fixture();
      context.requirePlan.mockResolvedValue({
        ...context.plan,
        [field]: "changed",
      });
      await expect(
        context.service.prepare("owner", context.plan, []),
      ).rejects.toMatchObject({ code: "plan_context_changed" });
    },
  );
});

describe("dispatch reauthorization", () => {
  it.each(["path", "directoryIdentity", "revision", "interpreter"] as const)(
    "refuses a changed %s after preparation",
    async (field) => {
      const context = fixture();
      const [script] = await context.service.prepare("owner", context.plan, []);
      if (!script) throw new Error("Missing script snapshot");
      if (field === "interpreter")
        context.executable.mockResolvedValue({
          ...context.interpreter,
          path: "/another/bash",
        });
      else
        context.resolve.mockResolvedValue({
          ...context.workspace,
          [field]: field === "revision" ? 2 : "changed",
        });
      await expect(
        context.service.reauthorize("owner", context.plan, script),
      ).rejects.toMatchObject({ code: "plan_context_changed" });
    },
  );

  it("refuses revoked plan execution rights", async () => {
    const context = fixture();
    const [script] = await context.service.prepare("owner", context.plan, []);
    if (!script || !context.plan.rights) throw new Error("Missing preparation");
    context.requirePlan.mockResolvedValue({
      ...context.plan,
      rights: { ...context.plan.rights, canRun: false },
    });
    await expect(
      context.service.reauthorize("owner", context.plan, script),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
  });

  it("rechecks source ticket access before dispatch", async () => {
    const context = fixture();
    const [script] = await context.service.prepare("owner", context.plan, []);
    if (!script) throw new Error("Missing script snapshot");
    const readTask = vi
      .spyOn(context.dependencies.tasks, "snapshot")
      .mockRejectedValue(new AgentError("plan_access_denied"));
    await expect(
      context.service.reauthorize("owner", context.plan, {
        ...script,
        taskIds: ["ticket"],
      }),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
    expect(readTask).toHaveBeenCalledWith(
      "owner",
      context.plan.projectId,
      "ticket",
    );
  });
});

describe("legacy script approval metadata", () => {
  it("returns no pending approvals even when old approval storage is unavailable", async () => {
    const context = fixture();
    const list = vi.fn(async () => {
      throw new Error("Legacy store unavailable");
    });
    const teams = new AgentPlanTeamService({
      access: {
        ...context.dependencies.access,
        validateTeams: async () => {},
        team: async () => ({
          projectId: context.plan.projectId,
          departmentIds: [],
          departmentId: null,
        }),
      },
      approvals: { list },
    });
    expect(await teams.scriptApproval(context.plan)).toEqual({
      hasScripts: true,
      unapprovedStepIds: [],
    });
    expect(list).not.toHaveBeenCalled();
  });
});
