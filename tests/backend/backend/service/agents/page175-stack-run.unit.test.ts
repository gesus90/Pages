import { expect, it } from "vitest";

import {
  STACK_TICKETS,
  finishedRun,
  flow,
  stackEngine,
  stackReport,
  stackRuntime,
} from "./page175-stack-fixture";

import type {
  AgentPlanNode,
  AgentPlanRun,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentPlanStack } from "@/definition/AgentPlanStack";

const DONE = stackReport();

function ticketStack(
  entries: readonly (typeof STACK_TICKETS)[number][] = STACK_TICKETS,
): AgentPlanStack {
  return {
    id: "stack",
    type: "stack",
    name: "Ticket-Stapel",
    x: 0,
    y: 400,
    entries: entries.map((ticket, index) => ({
      id: `entry-${index + 1}`,
      type: "task",
      taskId: ticket.id,
    })),
  };
}

/** An agent that reads the stack's content as its ticket and the stack's count as text. */
function reader(agent: AgentPlanStep): AgentPlanStep {
  return {
    ...agent,
    bindings: {
      aufgabe: { kind: "stack", stackId: "stack", output: "content" },
      anzahl: { kind: "stack", stackId: "stack", output: "count" },
    },
  };
}

function loopOf(
  steps: AgentPlanLoop["steps"],
  settings: Partial<AgentPlanLoop> = {},
): AgentPlanLoop {
  return {
    id: "loop",
    type: "loop",
    name: "Tickets nacheinander",
    x: 300,
    y: 0,
    steps,
    edges: [],
    runs: 1,
    runsSource: "parameter",
    bindings: { runs: { kind: "stack", stackId: "stack", output: "count" } },
    countMode: "expected",
    sessionPolicy: "fresh",
    condition: null,
    ...settings,
  };
}

function boundary(): readonly AgentPlanNode[] {
  return [
    { id: "start", type: "start", x: 0, y: 0 },
    { id: "end", type: "end", x: 1200, y: 0 },
  ];
}

function ticketPrompts(
  calls: readonly { readonly nodeId: string; readonly prompt: string }[],
  nodeId: string,
): readonly string[] {
  return calls
    .filter((call) => call.nodeId === nodeId)
    .map(
      (call) =>
        STACK_TICKETS.find((ticket) => call.prompt.includes(ticket.description))
          ?.key ?? "none",
    );
}

function loopRun(
  run: AgentPlanRun,
): NonNullable<AgentPlanRun["loops"]>[number] {
  const loop = run.loops?.find((entry) => entry.id === "loop");
  if (!loop) throw new Error("No loop record");
  return loop;
}

it("hands the first entry to the agent with its full ticket and the total count when the outer stack is triggered once", async () => {
  const runtime = stackRuntime({ work: [DONE] });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ agent }) => [...boundary(), ticketStack(), reader(agent("work"))],
    edges: [flow("start", "stack"), flow("stack", "work"), flow("work", "end")],
  });
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finishedRun(world, started.id);
  expect(run.status).toBe("succeeded");
  const prompt = runtime.calls[0]?.prompt ?? "";
  // The actual task: description, task list and criteria, not only a key or position.
  expect(prompt).toContain("# SYN-1: Anmeldung verbessern");
  expect(prompt).toContain("Das Login-Formular zeigt Fehler zu spät an.");
  expect(prompt).toContain("Fehlermeldung direkt am Feld anzeigen");
  expect(prompt).toContain("Kriterium SYN-1 erfüllt");
  expect(prompt).toContain("Total: 3");
  // The run contract names the handed-over ticket, so the agent may work on it.
  expect(prompt).toContain("- SYN-1 (ID `ticket-1`)");
  expect(prompt).not.toContain("SYN-2");
  expect(run.steps.find((step) => step.id === "stack")).toMatchObject({
    status: "succeeded",
    stack: { entryId: "entry-1", position: 1, total: 3 },
  });
  expect(run.stacks).toMatchObject([
    {
      id: "stack",
      total: 3,
      last: "entry",
      emptyTriggers: 0,
      deliveries: [{ entryId: "entry-1", position: 1, loopId: null }],
    },
  ]);
});

it("hands over one entry per iteration in order: count 3 from the stack, 1/3 to 3/3, then Out once", async () => {
  const runtime = stackRuntime({ work: [DONE, DONE, DONE], after: [DONE] });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ agent, plain }) => [
      ...boundary(),
      ticketStack(),
      loopOf([reader(agent("work"))]),
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
  expect(ticketPrompts(runtime.calls, "work")).toEqual([
    "SYN-1",
    "SYN-2",
    "SYN-3",
  ]);
  const loop = loopRun(run);
  expect(loop.count).toMatchObject({
    source: "stack",
    parameterId: "stack",
    effective: 3,
  });
  expect(loop.completion).toBe("count_reached");
  expect(loop.iterations.map((iteration) => iteration.status)).toEqual([
    "succeeded",
    "succeeded",
    "succeeded",
  ]);
  expect(
    loop.iterations.map(
      (iteration) =>
        iteration.nodes.find((node) => node.id === "stack")?.stack?.position,
    ),
  ).toEqual([1, 2, 3]);
  expect(run.stacks?.[0]?.deliveries.map((entry) => entry.iteration)).toEqual([
    1, 2, 3,
  ]);
  // Out fires once, after the third iteration: the successor ran exactly once.
  expect(runtime.calls.filter((call) => call.nodeId === "after")).toHaveLength(
    1,
  );
  expect(runtime.calls.map((call) => call.nodeId)).toEqual([
    "work",
    "work",
    "work",
    "after",
  ]);
  // The stack of a loop is a step of its iterations, not of the outer graph.
  expect(run.steps.some((step) => step.id === "stack")).toBe(false);
});

it("starts no further work once the stack is used up: extra triggers hand over nothing and never start over", async () => {
  const runtime = stackRuntime({ work: [DONE, DONE, DONE] });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ agent }) => [
      ...boundary(),
      ticketStack(),
      loopOf([reader(agent("work"))], {
        runsSource: "value",
        runs: 5,
        bindings: {},
      }),
    ],
    edges: [flow("start", "loop"), flow("stack", "work"), flow("loop", "end")],
  });
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finishedRun(world, started.id);
  expect(run.status).toBe("succeeded");
  expect(ticketPrompts(runtime.calls, "work")).toEqual([
    "SYN-1",
    "SYN-2",
    "SYN-3",
  ]);
  const loop = loopRun(run);
  expect(loop.iterations).toHaveLength(5);
  const late = loop.iterations.slice(3);
  for (const iteration of late) {
    expect(iteration.status).toBe("succeeded");
    expect(iteration.nodes.find((node) => node.id === "stack")).toMatchObject({
      status: "succeeded",
      stack: { entryId: null, position: 0, total: 3 },
    });
    expect(iteration.nodes.find((node) => node.id === "work")?.status).toBe(
      "skipped",
    );
  }
  expect(run.stacks?.[0]).toMatchObject({
    deliveries: [{ position: 1 }, { position: 2 }, { position: 3 }],
    emptyTriggers: 2,
    last: "empty",
  });
});

it("runs no iteration for a bound count of 0 from an empty stack and continues through Out", async () => {
  const runtime = stackRuntime({ work: [], after: [DONE] });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ agent, plain }) => [
      ...boundary(),
      ticketStack([]),
      loopOf([reader(agent("work"))]),
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
  const loop = loopRun(run);
  expect(loop.count).toMatchObject({ source: "stack", effective: 0 });
  expect(loop.iterations).toHaveLength(0);
  expect(loop.completion).toBe("count_reached");
  expect(runtime.calls.map((call) => call.nodeId)).toEqual(["after"]);
});

it("takes the total count, not the rest: a trigger before the loop does not shrink the count it resolved", async () => {
  const runtime = stackRuntime({ first: [DONE], work: [DONE, DONE, DONE] });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ agent, plain }) => [
      ...boundary(),
      ticketStack(),
      reader(agent("first")),
      loopOf([plain("work")]),
    ],
    edges: [
      flow("start", "stack"),
      flow("stack", "first"),
      flow("first", "loop"),
      flow("loop", "end"),
    ],
  });
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finishedRun(world, started.id);
  expect(run.status).toBe("succeeded");
  expect(loopRun(run).count?.effective).toBe(3);
  expect(loopRun(run).iterations).toHaveLength(3);
  expect(run.stacks?.[0]?.deliveries).toHaveLength(1);
});

it("reads a binding without triggering: a count binding alone hands over no entry", async () => {
  const runtime = stackRuntime({ work: [DONE] });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ agent }) => [
      ...boundary(),
      ticketStack(),
      {
        ...agent("work"),
        bindings: {
          aufgabe: {
            kind: "literal",
            value: { type: "ticket", ticketId: "ticket-2" },
          },
          anzahl: { kind: "stack", stackId: "stack", output: "count" },
        },
      },
    ],
    edges: [flow("start", "work"), flow("work", "end")],
  });
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finishedRun(world, started.id);
  expect(run.status).toBe("succeeded");
  expect(runtime.calls[0]?.prompt).toContain("Total: 3");
  expect(run.stacks).toBeUndefined();
});

it("starts again at the first entry in a new run of the plan", async () => {
  const runtime = stackRuntime({ work: [DONE, DONE] });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ agent }) => [...boundary(), ticketStack(), reader(agent("work"))],
    edges: [flow("start", "stack"), flow("stack", "work"), flow("work", "end")],
  });
  const first = await world.engine.start("owner", world.snapshot);
  await finishedRun(world, first.id);
  const second = await world.engine.start("owner", world.snapshot);
  const run = await finishedRun(world, second.id);
  expect(run.stacks?.[0]?.deliveries).toMatchObject([{ entryId: "entry-1" }]);
  expect(ticketPrompts(runtime.calls, "work")).toEqual(["SYN-1", "SYN-1"]);
});

it("keeps position, marks, loop target and progress through pause and resume of the same run, without a second handover", async () => {
  const runtime = stackRuntime({ work: [DONE, DONE, DONE] }, ["work"]);
  const world = await stackEngine(runtime.execution, {
    nodes: ({ agent }) => [
      ...boundary(),
      ticketStack(),
      loopOf([reader(agent("work"))]),
    ],
    edges: [flow("start", "loop"), flow("stack", "work"), flow("loop", "end")],
  });
  const started = await world.engine.start("owner", world.snapshot);
  // The first iteration has handed over its entry and its agent is working.
  await expect.poll(() => runtime.calls.length).toBe(1);
  await world.engine.pause(started.id);
  runtime.release("work");
  await expect
    .poll(() => world.read(started.id).status, { timeout: 8000 })
    .toBe("paused");
  const paused = world.read(started.id);
  expect(paused.stacks?.[0]?.deliveries.map((entry) => entry.entryId)).toEqual([
    "entry-1",
  ]);
  expect(loopRun(paused).count?.effective).toBe(3);
  expect(loopRun(paused).iterations.map((entry) => entry.status)).toEqual([
    "running",
  ]);
  expect(loopRun(paused).iterations[0]?.nodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "stack", status: "succeeded" }),
      expect.objectContaining({ id: "work", status: "running" }),
    ]),
  );
  expect(runtime.calls).toHaveLength(1);
  expect(runtime.closed).toEqual([]);
  await world.engine.resume(started.id, world.snapshot);
  const run = await finishedRun(world, started.id);
  expect(run.status).toBe("succeeded");
  // Exactly three handovers in the whole run, in order, none twice; the target stayed 3.
  expect(run.stacks?.[0]?.deliveries.map((entry) => entry.entryId)).toEqual([
    "entry-1",
    "entry-2",
    "entry-3",
  ]);
  expect(loopRun(run).count?.effective).toBe(3);
  expect(loopRun(run).iterations).toHaveLength(3);
  expect(ticketPrompts(runtime.calls, "work")).toEqual([
    "SYN-1",
    "SYN-2",
    "SYN-3",
  ]);
});
