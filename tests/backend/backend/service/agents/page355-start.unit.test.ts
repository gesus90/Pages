import { expect, it, vi } from "vitest";

import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { emptyPlanLoop } from "@/definition/AgentPlanLoop";
import { executablePlan, planStartIssues } from "@/definition/AgentPlanStart";
import { planWarnings } from "@/definition/AgentPlanWarnings";
import { AgentPlanStartActions } from "@/backend/service/agents/AgentPlanStartActions";
import { AgentPlanControlService } from "@/backend/service/agents/AgentPlanControlService";
import { prepareRecoveredPlan } from "@/backend/service/agents/AgentPlanContinuation";
import { ChatToolExecutor } from "@/backend/service/chat/ChatToolExecutor";
import { planDetail } from "@/backend/service/agents/AgentPlanOperationViews";

import {
  finishedRun,
  flow,
  stackEngine,
  stackReport,
  stackRuntime,
} from "./page175-stack-fixture";

import type { AgentPlanNode, AgentPlanInput } from "@/definition/AgentPlan";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";

const BOUNDARIES: readonly AgentPlanNode[] = [
  { id: "start", type: "start", x: 0, y: 0 },
  { id: "end", type: "end", x: 900, y: 0 },
];

function plan(
  nodes: readonly AgentPlanNode[],
  edges: AgentPlanInput["edges"],
): AgentPlanInput {
  return {
    name: "Test",
    workspaceId: "workspace",
    usage: "private",
    globals: {},
    nodes: [...BOUNDARIES, ...nodes],
    edges,
  };
}

it("runs a complete path and never prepares or executes detached empty agents or dead branches", async () => {
  const runtime = stackRuntime({ work: [stackReport()] });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ plain }) => [
      ...BOUNDARIES,
      plain("work"),
      { ...plain("free"), agentId: "missing", configuration: undefined },
      { ...plain("dead"), agentId: "missing", configuration: undefined },
    ],
    edges: [flow("start", "work"), flow("work", "end"), flow("start", "dead")],
  });
  expect(world.snapshot.steps.map((step) => step.step.id)).toEqual(["work"]);
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finishedRun(world, started.id);
  expect(run.status).toBe("succeeded");
  expect(run.steps.map((step) => step.id)).toEqual(["start", "work", "end"]);
  expect(runtime.calls.map((call) => call.nodeId)).toEqual(["work"]);
});

it("starts with a required ticket input missing, warns with node and field, and sends empty placeholders", async () => {
  const runtime = stackRuntime({ work: [stackReport()] });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ agent }) => {
      const node = agent("work");
      return [
        ...BOUNDARIES,
        {
          ...node,
          configuration: node.configuration && {
            ...node.configuration,
            template: {
              ...node.configuration.template,
              parameters: node.configuration.template.parameters.map(
                (parameter) => ({ ...parameter, isRequired: true }),
              ),
            },
          },
        },
      ];
    },
    edges: [flow("start", "work"), flow("work", "end")],
  });
  expect(planWarnings(world.plan, [])).toContainEqual({
    nodeId: "work",
    port: "aufgabe",
    reason: "required",
  });
  expect(planWarnings(world.plan, [])).toContainEqual({
    nodeId: "work",
    port: null,
    reason: "profileMissing",
  });
  expect(
    world.snapshot.steps[0]?.prepared.parameters.values.aufgabe,
  ).toBeNull();
  const started = await world.engine.start("owner", world.snapshot);
  expect((await finishedRun(world, started.id)).status).toBe("succeeded");
  expect(runtime.calls[0]?.prompt).toContain("Task:\n\n\nTotal: none");
  expect(runtime.calls[0]?.prompt).not.toContain("{{aufgabe}}");
});

it("starts a loop over an empty ticket stack, runs zero iterations, and executes its successor", async () => {
  const runtime = stackRuntime({ after: [stackReport()], work: [] });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ agent, plain }) => [
      ...BOUNDARIES,
      {
        id: "stack",
        type: "stack",
        name: "Tickets",
        x: 0,
        y: 200,
        entries: [],
      },
      {
        ...emptyPlanLoop("loop", "Tickets bearbeiten", { x: 200, y: 0 }),
        runsSource: "parameter",
        bindings: {
          runs: { kind: "stack", stackId: "stack", output: "count" },
        },
        steps: [
          {
            ...agent("work"),
            bindings: {
              aufgabe: { kind: "stack", stackId: "stack", output: "content" },
            },
          },
        ],
      },
      plain("after"),
    ],
    edges: [
      flow("start", "loop"),
      flow("stack", "work"),
      flow("loop", "after"),
      flow("after", "end"),
    ],
  });
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finishedRun(world, started.id);
  expect(run.status).toBe("succeeded");
  expect(run.loops?.[0]?.iterations).toEqual([]);
  expect(runtime.calls.map((call) => call.nodeId)).toEqual(["after"]);
});

it("refuses only the absent Start to End path before calling any model", async () => {
  const runtime = stackRuntime({ work: [] });
  await expect(
    stackEngine(runtime.execution, {
      nodes: ({ plain }) => [...BOUNDARIES, plain("work")],
      edges: [flow("start", "work")],
    }),
  ).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof AgentPlanValidationError &&
      error.issues.length === 1 &&
      error.issues[0]?.reason === "startEndDisconnected",
  );
  expect(runtime.calls).toEqual([]);
});

it("accepts Start directly connected to End, including a neutral empty loop", () => {
  expect(planStartIssues(plan([], [flow("start", "end")]))).toEqual([]);
  const loop = emptyPlanLoop("loop", "Empty", { x: 200, y: 0 });
  expect(
    planStartIssues(plan([loop], [flow("start", "loop"), flow("loop", "end")])),
  ).toEqual([]);
});

it("ignores data and event connections as proof of a start path", () => {
  for (const fromPort of ["value-out", "unknown"]) {
    expect(
      planStartIssues(plan([], [{ ...flow("start", "end"), fromPort }])),
    ).toHaveLength(1);
  }
  expect(
    planStartIssues(
      plan([], [{ ...flow("start", "end"), toPort: "event-in" }]),
    ),
  ).toHaveLength(1);
});

it("starts with malformed JSON on a connected input and passes an empty placeholder", async () => {
  const runtime = stackRuntime({ work: [stackReport()] });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ agent }) => [
      ...BOUNDARIES,
      {
        ...agent("work"),
        bindings: { aufgabe: { kind: "source", nodeId: "input" } },
      },
      {
        id: "input",
        type: "parameter",
        name: "input",
        format: "json",
        value: { type: "text", text: "{" },
        x: 0,
        y: 0,
      },
    ],
    edges: [flow("start", "work"), flow("work", "end")],
  });
  expect(planWarnings(world.plan, [])).toContainEqual({
    nodeId: "input",
    port: "value-out",
    reason: "json",
  });
  const started = await world.engine.start("owner", world.snapshot);
  expect((await finishedRun(world, started.id)).status).toBe("succeeded");
  expect(
    world.snapshot.steps[0]?.prepared.parameters.values.aufgabe,
  ).toBeNull();
});

it("keeps only connected members of groups and their referenced value sources", () => {
  const member = {
    id: "member",
    type: "agent" as const,
    agentId: "agent",
    personalAgentId: null,
    instruction: "",
    bindings: { input: { kind: "source" as const, nodeId: "source" } },
    x: 0,
    y: 0,
  };
  const input = plan(
    [
      {
        id: "group",
        type: "group",
        name: "Group",
        steps: [member, { ...member, id: "free", bindings: {} }],
        parameters: [],
        bindings: {},
        edges: [],
        x: 0,
        y: 0,
      },
      {
        id: "source",
        type: "parameter",
        name: "input",
        value: { type: "text", text: "" },
        format: "string",
        x: 0,
        y: 0,
      },
    ],
    [flow("start", "member"), flow("member", "end")],
  );
  expect(planStartIssues(input)).toEqual([]);
  const active = executablePlan(input);
  const group = active.nodes.find((node) => node.type === "group");
  expect(group?.steps.map((step) => step.id)).toEqual(["member"]);
  expect(active.nodes.some((node) => node.id === "source")).toBe(true);
  expect(planWarnings(input, [])).toContainEqual({
    nodeId: "free",
    port: null,
    reason: "unreachable",
  });
});

it("starts through saved and save-and-play entry points with missing parameters and a free node", async () => {
  const runtime = stackRuntime({
    work: [stackReport(), stackReport(), stackReport()],
  });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ agent, plain }) => [...BOUNDARIES, agent("work"), plain("free")],
    edges: [flow("start", "work"), flow("work", "end")],
  });
  const access = {
    require: async () => ({
      ...world.plan,
      canEdit: true,
      projectName: "Project",
      github: null,
    }),
  };
  const actions = new AgentPlanStartActions({
    access,
    preparation: world.preparation,
    engine: world.engine,
    plans: { save: vi.fn() },
    revise: async () => world.plan,
  });
  const first = await actions.play("owner", world.plan.id, world.plan.revision);
  expect((await finishedRun(world, first.id)).status).toBe("succeeded");
  // Saving is an external transaction boundary; execution still receives the real prepared snapshot.
  const saveActions = new AgentPlanStartActions({
    access,
    preparation: world.preparation,
    engine: {
      start: async (userId, snapshot) => {
        world.savePlan(snapshot);
        return world.engine.start(userId, snapshot);
      },
    },
    plans: { save: vi.fn() },
    revise: async () => world.plan,
  });
  const second = await saveActions.saveAndPlay(
    "owner",
    world.plan.id,
    world.plan,
  );
  expect((await finishedRun(world, second.id)).status).toBe("succeeded");
  world.savePlan(world.snapshot);
  const restarted = await world.engine.startRecovered(
    "owner",
    world.snapshot,
    {
      origin: {
        kind: "restart",
        runId: second.id,
        mode: null,
        checkpointVersion: null,
        reusedStepIds: [],
        retriedStepIds: ["work"],
        reviewedStepIds: [],
        requestedAt: first.startedAt,
      },
      reused: [],
      loops: [],
    },
    async () => {},
  );
  expect((await finishedRun(world, restarted.id)).status).toBe("succeeded");
  expect(runtime.calls.map((call) => call.nodeId)).toEqual([
    "work",
    "work",
    "work",
  ]);
  const controls = new AgentPlanControlService({
    access,
    preparation: world.preparation,
    profiles: { catalog: async () => [] },
    runs: {
      latest: async () => null,
      hasReservation: async () => false,
      findWorkspaceReservation: async () => null,
      resources: vi.fn(),
    },
  });
  expect(await controls.read("owner", world.plan.id)).toMatchObject({
    canPlay: true,
    issue: null,
  });
});

it("runs a decision with one complete branch and leaves its unselected branch unexecuted", async () => {
  const runtime = stackRuntime({ work: [stackReport()] });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ plain }) => [
      ...BOUNDARIES,
      {
        id: "condition",
        type: "parameter",
        name: "condition",
        format: "boolean",
        value: { type: "text", text: "true" },
        x: 0,
        y: 0,
      },
      {
        id: "decision",
        type: "decision",
        x: 100,
        y: 0,
        input: { kind: "source", nodeId: "condition" },
      },
      plain("work"),
    ],
    edges: [
      flow("start", "decision"),
      { ...flow("decision", "work"), fromPort: "true-out" },
      { ...flow("decision", "end"), fromPort: "false-out" },
      flow("work", "end"),
    ],
  });
  const started = await world.engine.start("owner", world.snapshot);
  expect((await finishedRun(world, started.id)).status).toBe("succeeded");
  expect(runtime.calls.map((call) => call.nodeId)).toEqual(["work"]);
});

it("retains event repair branches returning to a complete flow without using events to establish it", () => {
  const node = (id: string): AgentPlanNode => ({
    id,
    type: "agent",
    agentId: "agent",
    personalAgentId: null,
    bindings: {},
    instruction: "",
    x: 0,
    y: 0,
  });
  const input = plan(
    [node("work"), node("fix")],
    [
      flow("start", "work"),
      flow("work", "end"),
      flow("work", "fix"),
      { from: "fix", to: "work", fromPort: "value-out", toPort: "event-in" },
    ],
  );
  expect(executablePlan(input).nodes.map((entry) => entry.id)).toContain("fix");
});

it("Pica forwards Start to the same start actions and the agent API reports warnings separately from availability", async () => {
  const runtime = stackRuntime({ work: [stackReport()] });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ agent, plain }) => [...BOUNDARIES, agent("work"), plain("free")],
    edges: [flow("start", "work"), flow("work", "end")],
  });
  const view = {
    ...world.plan,
    canEdit: true,
    projectName: "Project",
    github: null,
  };
  const actions = new AgentPlanStartActions({
    access: { require: async () => view },
    preparation: world.preparation,
    engine: world.engine,
    plans: { save: vi.fn() },
    revise: async () => world.plan,
  });
  const pica = new ChatToolExecutor({
    identities: {
      verify: async (userId) => ({ userId, isAdmin: false, permissions: [] }),
    },
    router: {
      handle: async (identity, request): Promise<PagesAgentWriteResponse> => {
        expect(request.operation).toBe("plans.play");
        const run = await actions.play(
          identity.userId,
          world.plan.id,
          world.plan.revision,
        );
        return {
          apiVersion: "1",
          result: {
            planId: run.planId,
            revision: run.planRevision,
            runId: run.id,
            action: "plans.play",
            status: run.status,
          },
        };
      },
    },
  });
  const response = await pica.run(
    "owner",
    {
      operation: "plans.play",
      parameters: {
        planId: world.plan.id,
        expectedRevision: world.plan.revision,
      },
    },
    null,
  );
  expect(response.ok).toBe(true);
  const result = response.result;
  if (
    typeof result !== "object" ||
    result === null ||
    !("runId" in result) ||
    typeof result.runId !== "string"
  )
    throw new Error("No Pica run result");
  expect((await finishedRun(world, result.runId)).status).toBe("succeeded");
  expect(runtime.calls.map((call) => call.nodeId)).toEqual(["work"]);
  const projection = planDetail(view, {
    directory: { persons: [], groups: [], departments: [] },
    sources: { agents: [], tasks: [] },
    entries: [],
    starters: new Map(),
  });
  expect(projection.status).toMatchObject({ isRunnable: true, issues: [] });
  expect(projection.status.warnings).toContainEqual({
    nodeId: "free",
    port: null,
    problem: "unreachable",
  });
});

it("fails an incomplete step only when reached and adopts its corrected snapshot for continuation", async () => {
  const runtime = stackRuntime({
    before: [stackReport()],
    work: [stackReport()],
    after: [stackReport()],
  });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ plain }) => [
      ...BOUNDARIES,
      plain("before"),
      { ...plain("work"), configuration: undefined, agentId: "missing" },
      plain("after"),
    ],
    edges: [
      flow("start", "before"),
      flow("before", "work"),
      flow("work", "after"),
      flow("after", "end"),
    ],
  });
  const started = await world.engine.start("owner", world.snapshot);
  const failed = await finishedRun(world, started.id);
  expect(failed.status).toBe("failed");
  expect(failed.steps.find((step) => step.id === "work")).toMatchObject({
    status: "failed",
    error: "configuration_invalid",
  });
  expect(runtime.calls.map((call) => call.nodeId)).toEqual(["before"]);
  const work = world.snapshot.steps.find((step) => step.step.id === "after");
  if (!work) throw new Error("Missing correction template");
  const corrected = await world.preparation.prepare("owner", {
    ...world.plan,
    revision: world.plan.revision + 1,
    nodes: world.plan.nodes.map((node) =>
      node.id === "work"
        ? { ...work.step, id: "work", instruction: "Instruction work." }
        : node,
    ),
  });
  const completed = failed.steps.filter((step) => step.status === "succeeded");
  const adopted = prepareRecoveredPlan(
    {
      ...failed,
      status: "paused",
      pauseBoundary: {
        completedStepIds: completed.map((step) => step.id),
        frontierStepIds: ["work"],
        pendingStepIds: ["work", "after", "end"],
        pausedAt: failed.startedAt,
      },
    },
    world.snapshot,
    corrected,
  );
  expect(adopted.preparationFailures).toEqual({});
  world.savePlan(adopted);
  const resumed = await world.engine.startRecovered(
    "owner",
    adopted,
    {
      origin: {
        kind: "resume",
        runId: failed.id,
        mode: "new_session",
        checkpointVersion: null,
        reusedStepIds: completed.map((step) => step.id),
        retriedStepIds: ["work"],
        reviewedStepIds: ["work"],
        requestedAt: failed.startedAt,
      },
      reused: completed,
      loops: [],
    },
    async () => {},
  );
  expect((await finishedRun(world, resumed.id)).status).toBe("succeeded");
  expect(runtime.calls.map((call) => call.nodeId)).toEqual([
    "before",
    "work",
    "after",
  ]);
});
