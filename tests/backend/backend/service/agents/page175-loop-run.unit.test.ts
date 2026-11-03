import { expect, it } from "vitest";

import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";

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
  AgentPlanParameter,
  AgentPlanRun,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentPlanStack } from "@/definition/AgentPlanStack";

const DONE = stackReport();

function boundary(): readonly AgentPlanNode[] {
  return [
    { id: "start", type: "start", x: 0, y: 0 },
    { id: "end", type: "end", x: 1200, y: 0 },
  ];
}

function booleanParameter(text: string): AgentPlanParameter {
  return {
    id: "flag",
    type: "parameter",
    name: "weiter",
    format: "json",
    value: { type: "text", text },
    x: 0,
    y: 300,
  };
}

function loopOf(
  steps: AgentPlanLoop["steps"],
  settings: Partial<AgentPlanLoop> = {},
): AgentPlanLoop {
  return {
    id: "loop",
    type: "loop",
    name: "Schleife",
    x: 300,
    y: 0,
    steps,
    edges: [],
    runs: 2,
    runsSource: "value",
    bindings: {},
    countMode: "expected",
    sessionPolicy: "reuse",
    condition: null,
    ...settings,
  };
}

function groupOf(steps: readonly AgentPlanStep[]): AgentPlanGroup {
  return {
    id: "group",
    type: "group",
    name: "Bearbeiten → prüfen",
    x: 0,
    y: 0,
    steps,
    edges: steps.slice(1).map((step, index) => ({
      from: steps[index]?.id ?? "",
      to: step.id,
      fromPort: "flow-out",
      toPort: "flow-in",
    })),
    parameters: [],
    bindings: {},
  };
}

function ticketStack(): AgentPlanStack {
  return {
    id: "stack",
    type: "stack",
    name: "Ticket-Stapel",
    x: 0,
    y: 400,
    entries: STACK_TICKETS.map((ticket, index) => ({
      id: `entry-${index + 1}`,
      type: "task",
      taskId: ticket.id,
    })),
  };
}

function loopRun(
  run: AgentPlanRun,
): NonNullable<AgentPlanRun["loops"]>[number] {
  const loop = run.loops?.find((entry) => entry.id === "loop");
  if (!loop) throw new Error("No loop record");
  return loop;
}

it("checks the while boolean before the first iteration: initially false runs nothing and continues through Out", async () => {
  const runtime = stackRuntime({ work: [], after: [DONE] });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ plain }) => [
      ...boundary(),
      booleanParameter("false"),
      loopOf([plain("work")], {
        mode: "while",
        bindings: { while: { kind: "source", nodeId: "flag" } },
      }),
      plain("after"),
    ],
    edges: [flow("start", "loop"), flow("loop", "after"), flow("after", "end")],
  });
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finishedRun(world, started.id);
  expect(run.status).toBe("succeeded");
  const loop = loopRun(run);
  expect(loop.iterations).toHaveLength(0);
  expect(loop.completion).toBe("while_false");
  expect(loop.whileChecks).toMatchObject([
    { before: 1, source: "parameter", value: false },
  ]);
  expect(runtime.calls.map((call) => call.nodeId)).toEqual(["after"]);
});

it("reads a fresh boolean before every iteration and never reuses an earlier true", async () => {
  const answers = ['{"weiter": true}', '{"weiter": true}', '{"weiter": false}'];
  const runtime = stackRuntime({ work: [DONE, DONE, DONE] });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ plain, script }) => [
      ...boundary(),
      booleanParameter("true"),
      loopOf([plain("work"), script("check")], {
        mode: "while",
        edges: [flow("work", "check")],
        bindings: { while: { kind: "source", nodeId: "flag" } },
        while: { sourceNodeId: "check", outputPath: "$.weiter" },
      }),
    ],
    edges: [flow("start", "loop"), flow("loop", "end")],
    script: () => answers.shift() ?? "{}",
  });
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finishedRun(world, started.id);
  expect(run.status).toBe("succeeded");
  const loop = loopRun(run);
  expect(loop.iterations).toHaveLength(3);
  expect(loop.completion).toBe("while_false");
  expect(loop.whileChecks).toMatchObject([
    { before: 1, source: "parameter", value: true },
    { before: 2, source: "member", value: true },
    { before: 3, source: "member", value: true },
    { before: 4, source: "member", value: false },
  ]);
  // Every iteration finished its work before the next check: agent, then script, in order.
  expect(world.scriptCalls.map((call) => call.id)).toEqual([
    "check",
    "check",
    "check",
  ]);
  expect(runtime.calls).toHaveLength(3);
});

it("fails instead of reading false when the member's value is no boolean", async () => {
  const runtime = stackRuntime({ work: [DONE] });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ plain, script }) => [
      ...boundary(),
      booleanParameter("true"),
      loopOf([plain("work"), script("check")], {
        mode: "while",
        edges: [flow("work", "check")],
        bindings: { while: { kind: "source", nodeId: "flag" } },
        while: { sourceNodeId: "check", outputPath: "$.weiter" },
      }),
    ],
    edges: [flow("start", "loop"), flow("loop", "end")],
    script: () => '{"weiter": "no"}',
  });
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finishedRun(world, started.id);
  expect(run.status).toBe("failed");
  expect(run.steps.find((step) => step.id === "loop")?.error).toBe(
    "plan_loop_while_type",
  );
  expect(runtime.calls).toHaveLength(1);
});

it("refuses a while loop without a valid boolean before anything runs", async () => {
  const runtime = stackRuntime({ work: [] });
  await expect(
    stackEngine(runtime.execution, {
      nodes: ({ plain }) => [
        ...boundary(),
        booleanParameter('"ja"'),
        loopOf([plain("work")], {
          mode: "while",
          bindings: { while: { kind: "source", nodeId: "flag" } },
        }),
      ],
      edges: [flow("start", "loop"), flow("loop", "end")],
    }),
  ).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof AgentPlanValidationError &&
      error.issues.some(
        (issue) => issue.nodeId === "loop" && issue.reason === "loopWhile",
      ),
  );
  expect(runtime.calls).toHaveLength(0);
});

it("runs a group inside a loop strictly in order in one shared session across all iterations", async () => {
  const runtime = stackRuntime({ edit: [DONE, DONE], review: [DONE, DONE] });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ plain }) => [
      ...boundary(),
      loopOf([groupOf([plain("edit"), plain("review")])]),
    ],
    edges: [flow("start", "loop"), flow("loop", "end")],
  });
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finishedRun(world, started.id);
  expect(run.status).toBe("succeeded");
  expect(
    runtime.calls.map((call) => `${call.kind}:${call.nodeId}@${call.session}`),
  ).toEqual([
    "open:edit@loop/group",
    "next:review@loop/group",
    "next:edit@loop/group",
    "next:review@loop/group",
  ]);
  // The follow-up prompt hands the step to the existing session.
  expect(runtime.calls[1]?.prompt).toContain("sequential group");
  expect(runtime.closed).toEqual(["loop/group"]);
  expect(loopRun(run).iterations).toHaveLength(2);
});

it("opens one shared group session per iteration when the loop starts fresh sessions", async () => {
  const runtime = stackRuntime({ edit: [DONE, DONE], review: [DONE, DONE] });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ plain }) => [
      ...boundary(),
      loopOf([groupOf([plain("edit"), plain("review")])], {
        sessionPolicy: "fresh",
      }),
    ],
    edges: [flow("start", "loop"), flow("loop", "end")],
  });
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finishedRun(world, started.id);
  expect(run.status).toBe("succeeded");
  expect(
    runtime.calls.map((call) => `${call.kind}:${call.nodeId}@${call.session}`),
  ).toEqual([
    "open:edit@loop/group#1",
    "next:review@loop/group#1",
    "open:edit@loop/group#2",
    "next:review@loop/group#2",
  ]);
  expect(runtime.closed).toEqual(["loop/group#1", "loop/group#2"]);
});

it("hands each stack entry to the first agent of a group, which the second continues in the same session", async () => {
  const runtime = stackRuntime({
    edit: [DONE, DONE, DONE],
    review: [DONE, DONE, DONE],
  });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ agent, plain }) => [
      ...boundary(),
      ticketStack(),
      loopOf(
        [
          groupOf([
            {
              ...agent("edit"),
              bindings: {
                aufgabe: { kind: "stack", stackId: "stack", output: "content" },
                anzahl: { kind: "stack", stackId: "stack", output: "count" },
              },
            },
            plain("review"),
          ]),
        ],
        {
          runsSource: "parameter",
          bindings: {
            runs: { kind: "stack", stackId: "stack", output: "count" },
          },
        },
      ),
    ],
    edges: [flow("start", "loop"), flow("stack", "edit"), flow("loop", "end")],
  });
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finishedRun(world, started.id);
  expect(run.status).toBe("succeeded");
  const edits = runtime.calls.filter((call) => call.nodeId === "edit");
  expect(
    edits.map((call) =>
      STACK_TICKETS.findIndex((ticket) =>
        call.prompt.includes(ticket.description),
      ),
    ),
  ).toEqual([0, 1, 2]);
  expect(new Set(runtime.calls.map((call) => call.session))).toEqual(
    new Set(["loop/group"]),
  );
  expect(runtime.calls.map((call) => call.nodeId)).toEqual([
    "edit",
    "review",
    "edit",
    "review",
    "edit",
    "review",
  ]);
});

it("hands each stack entry to a script in the loop as its text input", async () => {
  const runtime = stackRuntime({});
  const world = await stackEngine(runtime.execution, {
    nodes: ({ script }) => [
      ...boundary(),
      ticketStack(),
      loopOf(
        [
          {
            ...script("process", ["aufgabe"]),
            bindings: {
              aufgabe: { kind: "stack", stackId: "stack", output: "content" },
            },
          },
        ],
        {
          runsSource: "parameter",
          bindings: {
            runs: { kind: "stack", stackId: "stack", output: "count" },
          },
        },
      ),
    ],
    edges: [
      flow("start", "loop"),
      flow("stack", "process"),
      flow("loop", "end"),
    ],
    script: (script, input) => `processed ${input.aufgabe?.split("\n")[0]}`,
  });
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finishedRun(world, started.id);
  expect(run.status).toBe("succeeded");
  expect(
    world.scriptCalls.map(
      (call) => (JSON.parse(call.input) as { aufgabe: string }).aufgabe,
    ),
  ).toEqual(
    STACK_TICKETS.map((ticket) =>
      expect.stringContaining(`# ${ticket.key}: ${ticket.title}`),
    ),
  );
  expect(
    loopRun(run).iterations.map(
      (iteration) =>
        iteration.nodes.find((node) => node.id === "process")?.output,
    ),
  ).toEqual([
    "processed # SYN-1: Anmeldung verbessern",
    "processed # SYN-2: Navigation vereinheitlichen",
    "processed # SYN-3: Speicherübersicht ergänzen",
  ]);
});

it("refuses a group whose agents run with different configurations instead of pretending they share a session", async () => {
  const runtime = stackRuntime({});
  await expect(
    stackEngine(runtime.execution, {
      nodes: ({ plain }) => {
        const review = plain("review");
        const changed: AgentPlanStep = {
          ...review,
          configuration: review.configuration && {
            ...review.configuration,
            model: "another-model",
          },
        };
        return [...boundary(), loopOf([groupOf([plain("edit"), changed])])];
      },
      edges: [flow("start", "loop"), flow("loop", "end")],
    }),
  ).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof AgentPlanValidationError &&
      error.issues.some(
        (issue) =>
          issue.nodeId === "review" && issue.reason === "groupConfiguration",
      ),
  );
});
