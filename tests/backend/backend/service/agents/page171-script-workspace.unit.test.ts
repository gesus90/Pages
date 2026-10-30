import { expect, it } from "vitest";

import { AgentPlanControlService } from "@/backend/service/agents/AgentPlanControlService";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import {
  AgentPlanPreparation,
  validateRemoteWorkingCopies,
} from "@/backend/service/agents/AgentPlanPreparation";
import { validatePlanWorkingCopies } from "@/backend/service/agents/AgentPlanWorkingCopies";
import { planWritingWorkspaces } from "@/backend/service/agents/AgentPlanContinuation";
import { remoteWorkspaceKeys } from "@/backend/service/agents/AgentPlanRemoteWorkspaceKey";
import {
  reservedWorkspaceConflict,
  workspaceConflict,
} from "@/backend/service/agents/AgentPlanWorkspaceConflict";
import { acpRunOptions } from "@/definition/AgentConfiguration";

import { recoveryFixture } from "./page84-recovery-fixture";
import { recoveryWorld } from "./page171-recovery-world";
import { remoteCompletion } from "./page171-remote-acceptance-fixture";

import type { AgentPlan, AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";
import type { AgentPlanScriptPreparation } from "@/backend/service/agents/AgentPlanScriptPreparation";
import type { ResolvedAgentWorkspace } from "@/definition/AgentWorkspace";

const FLOW = { fromPort: "flow-out", toPort: "flow-in" } as const;

function script(id: string): AgentPlanScript {
  return {
    id,
    type: "script",
    name: `Synthetic ${id}`,
    x: 200,
    y: 200,
    interpreterProfileId: "synthetic-python",
    content: "print('synthetic')",
    inputs: [],
    outputs: [],
    timeoutSeconds: 10,
    bindings: {},
  };
}

function syntheticRuns(
  plan: AgentPlan,
  isReserved: boolean,
  run: AgentPlanRun | null,
): Pick<
  AgentPlanRunRepository,
  "latest" | "hasReservation" | "findWorkspaceReservation" | "resources"
> {
  return {
    latest: async () => run,
    hasReservation: async () => isReserved,
    findWorkspaceReservation: async (ids, exceptRunId) =>
      isReserved &&
      ids.includes(plan.workspaceId) &&
      exceptRunId !== (run?.id ?? "other-run")
        ? plan.workspaceId
        : null,
    resources: async () => ({
      projectId: plan.projectId,
      workspaceIds: [plan.workspaceId],
      taskIds: [],
      wikiIds: [],
      ticketIds: [],
      agentIds: [],
    }),
  };
}

async function fixture(
  isSequential: boolean,
  isReserved = false,
  run: AgentPlanRun | null = null,
): Promise<{
  readonly plan: AgentPlan;
  readonly preparation: AgentPlanPreparation;
  readonly control: AgentPlanControlService;
}> {
  const original = await recoveryFixture();
  const plan: AgentPlan = {
    ...original.snapshot.plan,
    nodes: [
      { id: "start", type: "start", x: 0, y: 0 },
      script("first"),
      script("second"),
      { id: "end", type: "end", x: 600, y: 0 },
    ],
    edges: isSequential
      ? [
          { from: "start", to: "first", ...FLOW },
          { from: "first", to: "second", ...FLOW },
          { from: "second", to: "end", ...FLOW },
        ]
      : [
          { from: "start", to: "first", ...FLOW },
          { from: "start", to: "second", ...FLOW },
          { from: "first", to: "end", ...FLOW },
          { from: "second", to: "end", ...FLOW },
        ],
  };
  const workspace: ResolvedAgentWorkspace = {
    id: plan.workspaceId,
    projectId: plan.projectId,
    path: "/synthetic/repository",
    directoryIdentity: "synthetic-directory",
    revision: 1,
    github: null,
  };
  const scripts: Pick<AgentPlanScriptPreparation, "prepare" | "validate"> = {
    validate: async () => undefined,
    prepare: async (userId, input) => {
      if (userId !== "owner") throw new Error("Unexpected synthetic owner");
      return input.nodes.flatMap((node) =>
        node.type === "script"
          ? [
              {
                step: node,
                interpreter: {
                  id: node.interpreterProfileId,
                  name: "Synthetic Python",
                  path: "/usr/bin/python3",
                },
                workspace,
                inputs: {},
                taskIds: [],
              },
            ]
          : [],
      );
    },
  };
  const profiles = {
    catalog: async () => [],
    resolveDefinition: async () => {
      throw new Error("No agent in this synthetic plan");
    },
  };
  const preparation = new AgentPlanPreparation({
    profiles,
    parameters: {
      prepare: async () => {
        throw new Error("No agent parameters in this synthetic plan");
      },
    },
    tasks: {
      snapshot: async () => {
        throw new Error("No tickets in this synthetic plan");
      },
    },
    scripts,
  });
  const control = new AgentPlanControlService({
    profiles,
    preparation,
    access: {
      require: async () => ({
        ...plan,
        canEdit: true,
        projectName: "Synthetic project",
        github: null,
      }),
    },
    runs: syntheticRuns(plan, isReserved, run),
  });
  return { plan, preparation, control };
}

it("refuses parallel local scripts on one working copy before a run starts", async () => {
  const { plan, preparation, control } = await fixture(false);
  await expect(preparation.prepare("owner", plan)).rejects.toMatchObject({
    code: "plan_workspace_conflict",
  });
  await expect(control.read("owner", plan.id)).resolves.toMatchObject({
    canPlay: false,
    issue: "plan_workspace_conflict",
    workspaceConflict: {
      kind: "parallel_writers",
      targets: [
        {
          workspaceId: plan.workspaceId,
          kind: "local",
          path: "/synthetic/repository",
        },
      ],
      nodes: [
        { id: "first", name: "Synthetic first" },
        { id: "second", name: "Synthetic second" },
      ],
    },
  });
});

it("allows sequential scripts to use the same working copy in one run", async () => {
  const { plan, preparation, control } = await fixture(true);
  await expect(preparation.prepare("owner", plan)).resolves.toMatchObject({
    scripts: [{ step: { id: "first" } }, { step: { id: "second" } }],
  });
  await expect(control.read("owner", plan.id)).resolves.toMatchObject({
    canPlay: true,
  });
});

it("keeps Start available while actual writing resources remain coordinated", async () => {
  const { plan, control, preparation } = await fixture(true, true);
  await expect(control.read("owner", plan.id)).resolves.toMatchObject({
    canPlay: true,
    issue: null,
  });
  const snapshot = await preparation.prepare("owner", plan);
  expect(planWritingWorkspaces(snapshot)).toContain(
    "local-directory:/synthetic/repository",
  );
});

it("does not treat a paused run's own reservation as a competing writer", async () => {
  const sample = await recoveryFixture();
  const run: AgentPlanRun = {
    ...sample.failed,
    userId: "owner",
    status: "paused",
    stopRequested: false,
    steps: [],
    pauseBoundary: {
      pausedAt: "2026-10-28T10:00:00.000Z",
      completedStepIds: [],
      pendingStepIds: [],
      frontierStepIds: [],
    },
  };
  const { plan, control } = await fixture(true, true, run);

  await expect(control.read("owner", plan.id)).resolves.toMatchObject({
    canPlay: true,
    canRestart: true,
    canStop: true,
    canResume: true,
    issue: null,
  });
});

it("checks exact reserved workspaces while excluding the current run", async () => {
  const sample = await recoveryFixture();
  const world = recoveryWorld(sample, sample.failed);
  const database = world.database.asDatabase();
  await database.execute(
    "INSERT INTO agent_plan_workspace_locks (workspace_id, run_id) VALUES ($workspace_id, $run_id);",
    { workspace_id: "other-workspace", run_id: "other-run" },
  );
  const runs = new AgentPlanRunRepository(database);

  await expect(
    runs.findWorkspaceReservation(["free-workspace"]),
  ).resolves.toBeNull();
  await expect(
    runs.findWorkspaceReservation(["free-workspace", "other-workspace"]),
  ).resolves.toBe("other-workspace");
  await expect(
    runs.findWorkspaceReservation(["other-workspace"], "other-run"),
  ).resolves.toBeNull();
  await expect(
    runs.findWorkspaceReservation(["other-workspace"], "different-run"),
  ).resolves.toBe("other-workspace");
});

it("names the authorized remote connection and working copy without another run's identity", async () => {
  const remoteSample = await remoteCompletion(false);
  const remote = remoteSample.snapshot.remoteSteps?.[0];
  if (!remote) throw new Error("Expected a synthetic remote step");

  const conflict = reservedWorkspaceConflict(
    remoteSample.snapshot,
    remote.target.workspaceId,
  );
  expect(conflict).toMatchObject({
    kind: "reserved",
    targets: [
      {
        kind: "remote",
        workspaceId: remote.target.workspaceId,
        path: "/synthetic-remote",
        connectionName: "Controlled transport",
        workspaceName: "Synthetic remote workspace",
      },
    ],
    nodes: [{ id: remote.step.id }],
  });
  expect(JSON.stringify(conflict)).not.toContain("runId");
});

it("checks distinct registered remote copies and aliases using the pinned host and path", async () => {
  const sample = await remoteCompletion(false);
  const remote = sample.snapshot.remoteSteps?.[0];
  if (!remote) throw new Error("Expected a synthetic remote step");
  const target = { ...remote.target, hostIdentity: "a".repeat(64) };
  const alias = {
    ...target,
    connectionId: "other-connection",
    workspaceId: "alias",
  };
  const disjoint = { ...target, path: "/synthetic-other" };
  const otherHost = { ...alias, hostIdentity: "b".repeat(64) };
  const shared = remoteWorkspaceKeys(target).find((key) =>
    remoteWorkspaceKeys(alias).includes(key),
  );
  expect(shared).toBeDefined();
  expect(remoteWorkspaceKeys(target)).not.toEqual(
    remoteWorkspaceKeys(disjoint),
  );
  expect(
    remoteWorkspaceKeys(target).some((key) =>
      remoteWorkspaceKeys(disjoint).includes(key),
    ),
  ).toBe(false);
  expect(
    remoteWorkspaceKeys(target).some((key) =>
      remoteWorkspaceKeys(otherHost).includes(key),
    ),
  ).toBe(false);
  const unknownHost = { ...alias, hostIdentity: undefined };
  expect(
    remoteWorkspaceKeys(target).some((key) =>
      remoteWorkspaceKeys(unknownHost).includes(key),
    ),
  ).toBe(false);
});

it("maps a writing alias reservation back to its own node and target", async () => {
  const sample = await remoteCompletion(false);
  const original = sample.snapshot.remoteSteps?.[0];
  if (!original || original.command.program.kind !== "cli")
    throw new Error("Expected a synthetic remote CLI step");
  const remote = {
    ...original,
    command: {
      ...original.command,
      program: { ...original.command.program, access: "yolo" as const },
    },
  };
  const target = { ...remote.target, hostIdentity: "a".repeat(64) };
  const alias = {
    ...target,
    connectionId: "other-connection",
    workspaceId: "alias",
  };
  const snapshot = {
    ...sample.snapshot,
    remoteSteps: [{ ...remote, target: alias }],
  };
  const key = remoteWorkspaceKeys(target).find((entry) =>
    remoteWorkspaceKeys(alias).includes(entry),
  );
  if (!key) throw new Error("Expected a shared synthetic reservation");
  expect(planWritingWorkspaces(snapshot)).toContain(key);
  expect(reservedWorkspaceConflict(snapshot, key)).toMatchObject({
    kind: "reserved",
    targets: [{ workspaceId: "alias", path: target.path }],
    nodes: [{ id: remote.step.id }],
  });
  const recoverySample = await recoveryFixture();
  const database = recoveryWorld(
    recoverySample,
    recoverySample.failed,
  ).database.asDatabase();
  await database.execute(
    "INSERT INTO agent_plan_workspace_locks (workspace_id, run_id) VALUES ($workspace_id, $run_id);",
    { workspace_id: key, run_id: "other-run" },
  );
  const runs = new AgentPlanRunRepository(database);
  await expect(
    runs.findWorkspaceReservation(planWritingWorkspaces(snapshot)),
  ).resolves.toBe(key);
  await expect(
    runs.findWorkspaceReservation(planWritingWorkspaces(snapshot), "other-run"),
  ).resolves.toBeNull();
});

it("allows ordered aliases but rejects unordered remote writers on the same pinned host and path", async () => {
  const sample = await remoteCompletion(false);
  const remote = sample.snapshot.remoteSteps?.[0];
  if (!remote) throw new Error("Expected a synthetic remote step");
  const first = {
    ...remote,
    target: { ...remote.target, hostIdentity: "a".repeat(64) },
  };
  const second = {
    ...first,
    step: { ...first.step, id: "second" },
    target: { ...first.target, connectionId: "other", workspaceId: "alias" },
  };
  const plan = { ...sample.snapshot.plan, edges: [] };
  expect(() => validateRemoteWorkingCopies(plan, [first, second])).toThrowError(
    /working copy/u,
  );
  expect(() =>
    validateRemoteWorkingCopies(
      {
        ...plan,
        edges: [{ from: first.step.id, to: second.step.id, ...FLOW }],
      },
      [first, second],
    ),
  ).not.toThrow();
  expect(() =>
    validateRemoteWorkingCopies(plan, [
      first,
      { ...second, target: { ...second.target, path: "/synthetic-other" } },
    ]),
  ).not.toThrow();
});

it("filters credential-shaped text from a workspace conflict's display metadata", () => {
  const conflict = workspaceConflict("reserved", [
    {
      id: "node",
      name: "password=synthetic-value",
      target: {
        kind: "local",
        workspaceId: "workspace",
        path: "/synthetic/password=synthetic-value",
        connectionName: null,
        workspaceName: null,
      },
    },
  ]);
  expect(JSON.stringify(conflict)).not.toContain("synthetic-value");
});

it("checks a script against an unordered local agent using the resolved directory identity", async () => {
  const sample = await recoveryFixture();
  const agent = sample.snapshot.steps[0];
  const workspace = agent.prepared.workspace;
  const localScript = {
    step: script("script"),
    interpreter: {
      id: "synthetic-python",
      name: "Synthetic Python",
      path: "/usr/bin/python3",
    },
    workspace: {
      ...workspace,
      id: "another-registration",
      path: "/alias/repository",
    },
    inputs: {},
    taskIds: [],
  };

  expect(() =>
    validatePlanWorkingCopies(sample.snapshot.plan, [agent], [localScript]),
  ).toThrowError(/working copy/u);
  expect(() =>
    validatePlanWorkingCopies(
      sample.snapshot.plan,
      [agent],
      [
        {
          ...localScript,
          workspace: {
            ...localScript.workspace,
            path: `${workspace.path}/nested`,
            directoryIdentity: "nested-identity",
          },
        },
      ],
    ),
  ).toThrowError(/working copy/u);
  expect(() =>
    validatePlanWorkingCopies(
      sample.snapshot.plan,
      [agent],
      [
        {
          ...localScript,
          workspace: {
            ...localScript.workspace,
            id: "disjoint",
            path: "/other/repository",
            directoryIdentity: "other-identity",
          },
        },
      ],
    ),
  ).not.toThrow();
  expect(() =>
    validatePlanWorkingCopies(
      sample.snapshot.plan,
      [{ ...agent, provider: "openrouter" }],
      [localScript],
    ),
  ).not.toThrow();
  const ordered = {
    ...sample.snapshot.plan,
    edges: [{ from: agent.step.id, to: localScript.step.id, ...FLOW }],
  };
  expect(() =>
    validatePlanWorkingCopies(ordered, [agent], [localScript]),
  ).not.toThrow();
});

it("allows parallel read-only ACP reviewers but blocks an unordered writer", async () => {
  const sample = await recoveryFixture();
  const plan = { ...sample.snapshot.plan, edges: [] };
  const reviewers = sample.snapshot.steps.map((step) => ({
    ...step,
    template: { ...step.template, run: acpRunOptions("read_only", 0) },
  }));
  expect(() => validatePlanWorkingCopies(plan, reviewers, [])).not.toThrow();

  const writer = {
    ...reviewers[0],
    template: { ...reviewers[0].template, run: acpRunOptions("yolo", 0) },
  };
  expect(() =>
    validatePlanWorkingCopies(plan, [writer, ...reviewers.slice(1)], []),
  ).toThrowError(/working copy/u);
});

it("checks parallel loop writers while allowing ordered members", async () => {
  const sample = await recoveryFixture();
  const writers = sample.snapshot.steps.slice(0, 2).map((step) => ({
    ...step,
    loopId: "synthetic-loop",
    template: { ...step.template, run: acpRunOptions("yolo", 0) },
  }));
  const plan = { ...sample.snapshot.plan, edges: [] };
  expect(() => validatePlanWorkingCopies(plan, writers, [])).toThrowError(
    /working copy/u,
  );
  const ordered = {
    ...plan,
    edges: [{ from: writers[0].step.id, to: writers[1].step.id, ...FLOW }],
  };
  expect(() => validatePlanWorkingCopies(ordered, writers, [])).not.toThrow();
});
