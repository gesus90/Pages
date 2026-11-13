import { expect, it } from "vitest";

import {
  finishedRun,
  flow,
  stackEngine,
  stackReport,
  stackRuntime,
  STACK_TICKETS,
} from "./page175-stack-fixture";

import type { AgentPlanNode, AgentPlanStep } from "@/definition/AgentPlan";

function stackNodes(
  agent: (id: string) => AgentPlanStep,
): readonly AgentPlanNode[] {
  const work = {
    ...agent("work"),
    bindings: {
      aufgabe: {
        kind: "stack" as const,
        stackId: "stack",
        output: "content" as const,
      },
    },
  };
  return [
    { id: "start", type: "start", x: 0, y: 0 },
    { id: "end", type: "end", x: 1200, y: 0 },
    {
      id: "stack",
      type: "stack",
      name: "Tickets",
      x: 0,
      y: 400,
      entries: STACK_TICKETS.slice(0, 2).map((ticket) => ({
        id: ticket.id,
        type: "task" as const,
        taskId: ticket.id,
      })),
    },
    {
      id: "loop",
      type: "loop",
      name: "Iterations",
      x: 300,
      y: 0,
      steps: [work],
      edges: [],
      runs: 2,
      runsSource: "value",
      bindings: {},
      countMode: "expected",
      sessionPolicy: "fresh",
      condition: null,
    },
  ];
}

it("gives two stack iterations exactly their respective ticket TODOs with no previous iteration mixed in", async () => {
  const report = stackReport();
  const runtime = stackRuntime({ work: [report, report] });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ agent }) => stackNodes(agent),
    edges: [flow("start", "loop"), flow("stack", "work"), flow("loop", "end")],
  });
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finishedRun(world, started.id);
  expect(run.status).toBe("succeeded");
  const iterations = run.loops?.[0]?.iterations ?? [];
  expect(iterations).toHaveLength(2);
  for (const [index, iteration] of iterations.entries()) {
    const contract = iteration.nodes.find((node) => node.id === "work")?.session
      ?.contract;
    expect(contract?.todos).toHaveLength(2);
    expect(contract?.tickets.map((ticket) => ticket.id)).toEqual([
      `ticket-${index + 1}`,
    ]);
    expect(
      contract?.todos.every(
        (todo) => todo.ticket?.id === `ticket-${index + 1}`,
      ),
    ).toBe(true);
  }
  expect(runtime.calls).toHaveLength(2);
});
