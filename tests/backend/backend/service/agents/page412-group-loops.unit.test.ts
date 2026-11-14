import { expect, it, vi } from "vitest";

import { applyPlanChanges } from "@/backend/service/agents/AgentPlanStructureChanges";
import { planContainedEdges } from "@/definition/AgentPlanBranching";
import {
  instantiatePlanTemplate,
  planTemplateNode,
} from "@/definition/AgentPlanNodeTemplate";
import { AgentPlanCloneGraph } from "@/backend/service/agents/AgentPlanCloneGraph";
import { AgentPlanGroupSessions } from "@/backend/service/agents/AgentPlanGroupSessions";
import { restoreLocalStepSessions } from "@/backend/service/agents/AgentPlanLocalSessions";
import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { planConnectionIssues } from "@/definition/AgentPlanGraph";
import { emptyPlanLoop } from "@/definition/AgentPlanLoop";
import {
  allPlanLoops,
  planContainedNodes,
  placePlanLoopInGroup,
} from "@/definition/AgentPlanGroupLoop";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";

import { groupFixture } from "./page73-group-fixture";
import {
  STACK_TICKETS,
  finishedRun,
  flow,
  stackEngine,
  stackReport,
  stackRuntime,
} from "./page175-stack-fixture";

import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanNode } from "@/definition/AgentPlan";
import type { StackNodes } from "./page175-stack-fixture";

function nodes(build: StackNodes): readonly AgentPlanNode[] {
  const first = {
    ...emptyPlanLoop("loop", "Tickets", { x: 200, y: 0 }),
    runs: 2,
    sessionPolicy: "fresh" as const,
    steps: [build.plain("work"), build.script("script")],
    edges: [flow("work", "script")],
  };
  const second = {
    ...emptyPlanLoop("second-loop", "More", { x: 1100, y: 0 }),
    runs: 2,
    steps: [build.plain("review")],
  };
  const group: AgentPlanGroup = {
    id: "group",
    type: "group",
    name: "Context",
    x: 200,
    y: 100,
    steps: [build.plain("before"), build.plain("after")],
    loops: [first, second],
    edges: [
      flow("before", "loop"),
      flow("loop", "second-loop"),
      flow("second-loop", "after"),
    ],
    parameters: [],
    bindings: {},
  };
  return [
    { id: "start", type: "start", x: 0, y: 0 },
    group,
    { id: "end", type: "end", x: 3000, y: 0 },
  ];
}

it("continues one outer group thread before, across two loops and their iterations, and afterwards", async () => {
  const done = stackReport();
  const runtime = stackRuntime({
    before: [done],
    work: [done, done],
    review: [done, done],
    after: [done],
  });
  const world = await stackEngine(runtime.execution, {
    nodes,
    edges: [flow("start", "before"), flow("after", "end")],
  });
  expect(
    world.snapshot.steps.map((step) => [step.step.id, step.groupId]),
  ).toEqual([
    ["before", "group"],
    ["after", "group"],
    ["work", "group"],
    ["review", "group"],
  ]);
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finishedRun(world, started.id);
  expect(run.status).toBe("succeeded");
  expect(runtime.calls.map((call) => [call.kind, call.nodeId])).toEqual([
    ["open", "before"],
    ["next", "work"],
    ["next", "work"],
    ["next", "review"],
    ["next", "review"],
    ["next", "after"],
  ]);
  expect(new Set(runtime.calls.map((call) => call.session)).size).toBe(1);
  expect(runtime.closed).toHaveLength(1);
  expect(world.scriptCalls).toHaveLength(2);
  const sessions = allPlanRunResults(run).flatMap((result) =>
    result.session ? [result.session] : [],
  );
  expect(sessions).toHaveLength(6);
  expect(new Set(sessions.map((session) => session.attemptId)).size).toBe(6);
  expect(new Set(sessions.map((session) => session.instanceId)).size).toBe(1);
  expect(new Set(sessions.map((session) => session.sessionId)).size).toBe(1);
  expect(
    sessions.every(
      (session) =>
        session.group?.groupId === "group" && session.closeout === "confirmed",
    ),
  ).toBe(true);
  expect(runtime.calls[1]?.prompt).not.toContain(
    "nothing of earlier iterations is retained",
  );
  expect(
    run.loops?.every(
      (loop) => loop.iterations.length === 2 && loop.status === "succeeded",
    ),
  ).toBe(true);
});

it("round-trips loop membership and moves whole loops without losing flow or bindings", async () => {
  const world = await stackEngine(stackRuntime({}).execution, {
    nodes,
    edges: [flow("start", "before"), flow("after", "end")],
  });
  const parsed = readPlanInput(JSON.parse(JSON.stringify(world.plan)));
  expect(allPlanLoops(parsed)).toHaveLength(2);
  const moved = placePlanLoopInGroup(
    parsed,
    { loopId: "loop", groupId: null, position: { x: 2000, y: 700 } },
    [],
  );
  if (typeof moved === "string") throw new Error(moved);
  expect(moved.removedBindings + moved.removedEdges).toBe(0);
  expect(planConnectionIssues(moved.plan, [])).toEqual([]);
  const returned = placePlanLoopInGroup(
    moved.plan,
    { loopId: "loop", groupId: "group", position: { x: 220, y: 40 } },
    [],
  );
  expect(returned).not.toBeTypeOf("string");
});

it("retains the group through pause and resume and opens a fresh owner for a new full start", async () => {
  const done = stackReport();
  const runtime = stackRuntime(
    {
      before: [done, done],
      work: [done, done, done, done],
      review: [done, done, done, done],
      after: [done, done],
    },
    ["before"],
  );
  const world = await stackEngine(runtime.execution, {
    nodes,
    edges: [flow("start", "before"), flow("after", "end")],
  });
  const started = await world.engine.start("owner", world.snapshot);
  await vi.waitFor(() => expect(runtime.calls).toHaveLength(1));
  await world.engine.pause(started.id);
  runtime.release("before");
  await vi.waitFor(() => expect(world.read(started.id).status).toBe("paused"));
  expect(runtime.closed).toHaveLength(0);
  await world.engine.resume(started.id);
  expect((await finishedRun(world, started.id)).status).toBe("succeeded");
  expect(runtime.calls.filter((call) => call.kind === "open")).toHaveLength(1);
  const restarted = await world.engine.start("owner", world.snapshot);
  expect((await finishedRun(world, restarted.id)).status).toBe("succeeded");
  expect(runtime.calls.filter((call) => call.kind === "open")).toHaveLength(2);
  expect(runtime.closed).toHaveLength(2);
});

it("rejects incompatible inner agents and unsupported container recursion", async () => {
  const world = await stackEngine(stackRuntime({}).execution, {
    nodes,
    edges: [flow("start", "before"), flow("after", "end")],
  });
  const changed = {
    ...world.plan,
    nodes: world.plan.nodes.map((node) =>
      node.type !== "group"
        ? node
        : {
            ...node,
            loops: node.loops?.map((loop) => ({
              ...loop,
              steps: loop.steps.map((step) =>
                step.type !== "agent" || !step.configuration
                  ? step
                  : {
                      ...step,
                      configuration: {
                        ...step.configuration,
                        provider: "claude_code" as const,
                      },
                    },
              ),
            })),
          },
    ),
  };
  expect(planConnectionIssues(changed, [])).toContainEqual(
    expect.objectContaining({ reason: "groupProvider" }),
  );
  const group = world.plan.nodes.find((node) => node.type === "group");
  if (!group) throw new Error("Missing group");
  expect(() =>
    readPlanInput({
      ...world.plan,
      nodes: [
        {
          ...group,
          loops: [{ ...allPlanLoops(world.plan)[0], steps: [group] }],
        },
      ],
    }),
  ).toThrow();
});

it("opens the owner from a loop when no outer agent ran and preserves it across an iteration pause", async () => {
  const done = stackReport();
  const runtime = stackRuntime({ work: [done, done], review: [done, done] }, [
    "work",
  ]);
  const world = await stackEngine(runtime.execution, {
    nodes: (build) =>
      nodes(build).map((node) =>
        node.type !== "group"
          ? node
          : { ...node, steps: [], edges: [flow("loop", "second-loop")] },
      ),
    edges: [flow("start", "loop"), flow("second-loop", "end")],
  });
  const started = await world.engine.start("owner", world.snapshot);
  await vi.waitFor(() => expect(runtime.calls).toHaveLength(1));
  await world.engine.pause(started.id);
  runtime.release("work");
  await vi.waitFor(() => expect(world.read(started.id).status).toBe("paused"));
  expect(runtime.closed).toHaveLength(0);
  await world.engine.resume(started.id);
  const run = await finishedRun(world, started.id);
  expect(run.status).toBe("succeeded");
  expect(runtime.calls.map((call) => call.kind)).toEqual([
    "open",
    "next",
    "next",
    "next",
  ]);
});

it("keeps current and previous-iteration inputs when a member inherits the outer session", async () => {
  const done = stackReport();
  const runtime = stackRuntime({
    before: [done],
    work: [stackReport("earlier-fact"), done],
    review: [done, done],
    after: [done],
  });
  const world = await stackEngine(runtime.execution, {
    nodes: (build) =>
      nodes(build).map((node) =>
        node.type !== "group"
          ? node
          : {
              ...node,
              loops: node.loops?.map((loop) =>
                loop.id !== "loop"
                  ? loop
                  : {
                      ...loop,
                      steps: loop.steps.map((member) =>
                        member.id !== "work"
                          ? member
                          : {
                              ...build.agent("work"),
                              bindings: {
                                anzahl: {
                                  kind: "previous" as const,
                                  stepId: "work",
                                },
                              },
                            },
                      ),
                    },
              ),
            },
      ),
    edges: [flow("start", "before"), flow("after", "end")],
  });
  const started = await world.engine.start("owner", world.snapshot);
  expect((await finishedRun(world, started.id)).status).toBe("succeeded");
  const work = runtime.calls.filter((call) => call.nodeId === "work");
  expect(work[0]?.prompt).toContain("Total: none");
  expect(work[1]?.prompt).toContain("earlier-fact");
});

it("serializes ready turns from parallel loops through their shared owner", async () => {
  const done = stackReport();
  const runtime = stackRuntime({ work: [done, done], review: [done, done] }, [
    "work",
  ]);
  const world = await stackEngine(runtime.execution, {
    nodes: (build) =>
      nodes(build).map((node) =>
        node.type !== "group"
          ? node
          : {
              ...node,
              steps: [],
              edges: [],
              loops: node.loops?.map((loop) => ({
                ...loop,
                steps: loop.steps.filter((step) => step.type === "agent"),
                edges: [],
              })),
            },
      ),
    edges: [
      flow("start", "loop"),
      flow("start", "second-loop"),
      flow("loop", "end"),
      flow("second-loop", "end"),
    ],
  });
  const started = await world.engine.start("owner", world.snapshot);
  await vi.waitFor(() => expect(runtime.calls).toHaveLength(1));
  // Both loops have dispatched work, but the second turn is still waiting for the native owner.
  await vi.waitFor(() =>
    expect(
      world.read(started.id).loops?.every((loop) => loop.status === "running"),
    ).toBe(true),
  );
  expect(runtime.calls).toHaveLength(1);
  runtime.release("work");
  expect((await finishedRun(world, started.id)).status).toBe("succeeded");
  expect(runtime.calls.filter((call) => call.kind === "open")).toHaveLength(1);
  expect(runtime.closed).toHaveLength(1);
});

it("closes a paused group's actual owner on stop", async () => {
  const done = stackReport();
  const runtime = stackRuntime(
    { before: [done], work: [], review: [], after: [] },
    ["before"],
  );
  const world = await stackEngine(runtime.execution, {
    nodes,
    edges: [flow("start", "before"), flow("after", "end")],
  });
  const started = await world.engine.start("owner", world.snapshot);
  await vi.waitFor(() => expect(runtime.calls).toHaveLength(1));
  await world.engine.pause(started.id);
  runtime.release("before");
  await vi.waitFor(() => expect(world.read(started.id).status).toBe("paused"));
  await world.engine.stop(started.id);
  expect((await finishedRun(world, started.id)).status).toBe("cancelled");
  expect(runtime.closed).toEqual(["group"]);
});

it("remembers an unavailable restored group owner instead of opening an empty replacement thread", async () => {
  const done = stackReport();
  const runtime = stackRuntime({
    before: [done],
    work: [done, done],
    review: [done, done],
    after: [done],
  });
  const world = await stackEngine(runtime.execution, {
    nodes,
    edges: [flow("start", "before"), flow("after", "end")],
  });
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finishedRun(world, started.id);
  const restoredRuntime = stackRuntime({});
  const groups = new AgentPlanGroupSessions(restoredRuntime.execution);
  const fixture = await groupFixture();
  const observer = {
    started: () => undefined,
    identified: () => undefined,
    progressed: () => undefined,
  };
  await restoreLocalStepSessions(run, world.snapshot, {
    groups,
    retained: new Map(),
    groupInputs: new Map(),
    save: async () => undefined,
    observer: () => observer,
    start: fixture.base.start,
    offer: () => undefined,
  });
  const prepared = await fixture.base.start.prepare(
    fixture.base.run,
    fixture.base.snapshot,
    fixture.base.step,
  );
  await expect(
    groups.turn({
      key: `${run.id}/group`,
      input: {
        ...prepared.input,
        options: prepared.options,
        instanceId: "replacement",
      },
      signal: new AbortController().signal,
      observer,
    }),
  ).rejects.toMatchObject({ code: "plan_group_session_lost" });
  expect(restoredRuntime.execution.open).not.toHaveBeenCalled();
});

it("uses the existing structured mutation path for nested loop placement, settings, bindings and internal flow", async () => {
  const world = await stackEngine(stackRuntime({}).execution, {
    nodes: (build) =>
      nodes({
        ...build,
        plain: (id, x) =>
          id === "work" ? build.agent(id, x) : build.plain(id, x),
      }),
    edges: [flow("start", "before"), flow("after", "end")],
  });
  const changed = applyPlanChanges(
    world.plan,
    [
      { action: "placeNode", nodeId: "loop", groupId: null, x: 2000, y: 100 },
      { action: "placeNode", nodeId: "loop", groupId: "group", x: 220, y: 60 },
      {
        action: "updateNode",
        nodeId: "loop",
        fields: { name: "Updated tickets" },
      },
      {
        action: "bind",
        nodeId: "work",
        parameter: "anzahl",
        binding: {
          kind: "literal",
          value: { type: "text", text: "current input" },
        },
      },
      { action: "disconnect", from: "work", to: "script" },
      { action: "connect", from: "work", to: "script" },
    ],
    { agents: [] },
  ).plan;
  const restored = readPlanInput(JSON.parse(JSON.stringify(changed)));
  expect(
    allPlanLoops(restored).find((loop) => loop.id === "loop"),
  ).toMatchObject({
    name: "Updated tickets",
    x: 220,
    y: 60,
    edges: [flow("work", "script")],
  });
  expect(
    planContainedNodes(restored).find((node) => node.id === "work"),
  ).toMatchObject({
    bindings: {
      anzahl: {
        kind: "literal",
        value: { type: "text", text: "current input" },
      },
    },
  });
  expect(planContainedEdges(restored)).toEqual(
    expect.arrayContaining(planContainedEdges(world.plan)),
  );
  expect(planConnectionIssues(restored, [])).toEqual([]);
});

it("copies grouped loops with independent identities through cloning and group templates", async () => {
  const world = await stackEngine(stackRuntime({}).execution, {
    nodes,
    edges: [flow("start", "before"), flow("after", "end")],
  });
  const copied = {
    ...world.plan,
    ...new AgentPlanCloneGraph(world.plan).copy(),
  };
  expect(planConnectionIssues(copied, [])).toEqual([]);
  const originalIds = new Set(
    planContainedNodes(world.plan).map((node) => node.id),
  );
  expect(
    planContainedNodes(copied).every((node) => !originalIds.has(node.id)),
  ).toBe(true);
  const group = world.plan.nodes.find((node) => node.type === "group");
  if (!group) throw new Error("Missing group");
  let index = 0;
  const template = instantiatePlanTemplate(
    planTemplateNode(group),
    () => `copy-${++index}`,
  );
  expect(planContainedNodes({ nodes: [template] })).toHaveLength(
    planContainedNodes({ nodes: [group] }).length,
  );
  expect(
    planContainedNodes({ nodes: [template] }).every(
      (node) => !originalIds.has(node.id),
    ),
  ).toBe(true);
  expect(
    readPlanInput({ ...world.plan, nodes: [template], edges: [] }).nodes,
  ).toEqual([template]);
});

it("keeps stack inputs and agent-to-script results scoped to the current iteration in the group", async () => {
  const done = stackReport();
  const runtime = stackRuntime({
    before: [done],
    work: [done, done, done],
    after: [done],
  });
  const world = await stackEngine(runtime.execution, {
    nodes: (build) => [
      ...nodes(build).map((node) =>
        node.type !== "group"
          ? node
          : {
              ...node,
              loops: node.loops
                ?.filter((loop) => loop.id === "loop")
                .map((loop) => ({
                  ...loop,
                  runsSource: "parameter" as const,
                  bindings: {
                    runs: {
                      kind: "stack" as const,
                      stackId: "tickets",
                      output: "count" as const,
                    },
                  },
                  steps: [
                    {
                      ...build.agent("work"),
                      bindings: {
                        aufgabe: {
                          kind: "stack" as const,
                          stackId: "tickets",
                          output: "content" as const,
                        },
                        anzahl: {
                          kind: "stack" as const,
                          stackId: "tickets",
                          output: "count" as const,
                        },
                      },
                    },
                    {
                      ...build.script("script", ["result"]),
                      bindings: {
                        result: { kind: "result" as const, stepId: "work" },
                      },
                    },
                  ],
                })),
              edges: [flow("before", "loop"), flow("loop", "after")],
            },
      ),
      {
        id: "tickets",
        type: "stack",
        name: "Tickets",
        x: 0,
        y: 500,
        entries: STACK_TICKETS.map((ticket) => ({
          id: ticket.id,
          type: "task" as const,
          taskId: ticket.id,
        })),
      },
    ],
    edges: [
      flow("start", "before"),
      flow("tickets", "work"),
      flow("after", "end"),
    ],
  });
  expect(planConnectionIssues(world.plan, [])).toEqual([]);
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finishedRun(world, started.id);
  expect(run.status).toBe("succeeded");
  const work = runtime.calls.filter((call) => call.nodeId === "work");
  expect(work).toHaveLength(3);
  STACK_TICKETS.forEach((ticket, index) =>
    expect(work[index]?.prompt).toContain(ticket.key),
  );
  expect(world.scriptCalls).toHaveLength(3);
  expect(
    world.scriptCalls.every((call) =>
      call.input.includes("synthetic observable result"),
    ),
  ).toBe(true);
  expect(new Set(runtime.calls.map((call) => call.session)).size).toBe(1);
});
