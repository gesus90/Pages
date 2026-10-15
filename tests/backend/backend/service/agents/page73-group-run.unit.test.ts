import { expect, it, vi } from "vitest";

import { AgentPlanStepRunner } from "@/backend/service/agents/AgentPlanStepRunner";

import { groupEngine, groupTurn, groupFixture } from "./page73-group-fixture";

import type {
  PlanExecution,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";

function deferredTurn(): {
  readonly promise: Promise<PlanSessionTurn>;
  readonly resolve: (turn: PlanSessionTurn) => void;
} {
  let complete: (turn: PlanSessionTurn) => void = () => {
    throw new Error("Turn not initialized");
  };
  const promise = new Promise<PlanSessionTurn>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: complete };
}

it("reports cancellation when stop arrives during preparation before the first native session opens", async () => {
  const runtime = executionFixture();
  const fixture = await groupFixture();
  const first = fixture.snapshot.steps[0];
  if (!first) throw new Error("Missing first group step");
  const controller = new AbortController();
  const runner = new AgentPlanStepRunner({
    start: fixture.base.start,
    execution: runtime.execution,
    tasks: {
      checklist: async (): Promise<never> => {
        throw new Error("No tickets");
      },
    },
    access: {
      grant: async () => {
        controller.abort();
        return null;
      },
      revoke: async () => 0,
    },
  });
  const result = await runner.run(fixture.base.run, fixture.snapshot, first, {
    signal: controller.signal,
    save: async () => {},
  });
  expect(result).toMatchObject({
    status: "cancelled",
    cancellation: "not_started",
  });
  expect(runtime.open).not.toHaveBeenCalled();
});

function executionFixture(): {
  readonly execution: PlanExecution;
  readonly first: ReturnType<typeof deferredTurn>;
  readonly second: ReturnType<typeof deferredTurn>;
  readonly open: ReturnType<typeof vi.fn<PlanExecution["open"]>>;
  readonly next: ReturnType<
    typeof vi.fn<
      NonNullable<Awaited<ReturnType<PlanExecution["open"]>>["next"]>
    >
  >;
  readonly close: ReturnType<
    typeof vi.fn<Awaited<ReturnType<PlanExecution["open"]>>["close"]>
  >;
} {
  const first = deferredTurn();
  const second = deferredTurn();
  const close = vi.fn(async () => ({
    exit: { code: 0, signal: null },
    endedAt: "2026-10-15T00:00:00Z",
    leftovers: 0,
    isConfirmed: true,
  }));
  const next = vi.fn<
    NonNullable<Awaited<ReturnType<PlanExecution["open"]>>["next"]>
  >(async (input, signal) => {
    signal.addEventListener(
      "abort",
      () => second.resolve(groupTurn({ failure: "cancelled", output: "" })),
      { once: true },
    );
    return second.promise;
  });
  const open = vi.fn<PlanExecution["open"]>(async (input, signal) => {
    signal.addEventListener(
      "abort",
      () => first.resolve(groupTurn({ failure: "cancelled", output: "" })),
      { once: true },
    );
    return { turn: first.promise, next, close };
  });
  const execution: PlanExecution = {
    run: async () => {
      throw new Error("No API requests");
    },
    open,
  };
  return { execution, first, second, open, next, close };
}

it("uses one native session, releases the outer successor only after both accepted turns and reports the group", async () => {
  const runtime = executionFixture();
  const world = await groupEngine(runtime.execution);
  const prepareGroup = vi.spyOn(world.base.start, "prepareGroup");
  const run = await world.engine.start("owner", world.snapshot);
  await vi.waitFor(() => expect(runtime.open).toHaveBeenCalledTimes(1));
  expect(runtime.next).not.toHaveBeenCalled();
  expect(
    world.stored.get(run.id)?.steps.find((step) => step.id === "end")?.status,
  ).toBe("waiting");
  runtime.first.resolve(groupTurn());
  await vi.waitFor(() => expect(runtime.next).toHaveBeenCalledTimes(1));
  expect(runtime.close).not.toHaveBeenCalled();
  const secondPrompt = runtime.next.mock.calls[0]?.[0].prompt;
  expect(secondPrompt).toContain("Instruction second");
  expect(secondPrompt).not.toContain("Instruction first");
  expect(secondPrompt).toContain("Shared shared-text");
  expect(secondPrompt).toContain("Missing or invalid reports");
  expect(secondPrompt).not.toContain("diagnostic information only");
  runtime.second.resolve(groupTurn());
  await vi.waitFor(() =>
    expect(world.stored.get(run.id)?.status).toBe("succeeded"),
  );
  expect(runtime.open).toHaveBeenCalledTimes(1);
  expect(prepareGroup).toHaveBeenCalledOnce();
  expect(runtime.close).toHaveBeenCalledTimes(1);
  const agents = world.stored
    .get(run.id)
    ?.steps.filter((step) => step.groupId === "group");
  expect(agents?.map((step) => step.session?.sessionId)).toEqual([
    "native-synthetic",
    "native-synthetic",
  ]);
  expect(agents?.map((step) => step.session?.closeout)).toEqual([
    "confirmed",
    "confirmed",
  ]);
  expect(
    world.stored.get(run.id)?.steps.find((step) => step.id === "group")?.status,
  ).toBe("succeeded");
});

it.each([
  { name: "missing report", output: "No closing report" },
  { name: "invalid report", output: "```pages-report\n{invalid}\n```" },
  { name: "open todo", output: groupTurn().output.replace('"done"', '"open"') },
  {
    name: "unmet criterion",
    output: groupTurn().output.replace('"met":true', '"met":false'),
  },
  {
    name: "missing evidence",
    output: groupTurn().output.replace("synthetic observable result", ""),
  },
])(
  "fails the group after $name and never starts its next agent",
  async ({ output }) => {
    const runtime = executionFixture();
    const world = await groupEngine(runtime.execution);
    const run = await world.engine.start("owner", world.snapshot);
    await vi.waitFor(() => expect(runtime.open).toHaveBeenCalledOnce());
    runtime.first.resolve(groupTurn({ output }));
    await vi.waitFor(() =>
      expect(world.stored.get(run.id)?.status).toBe("failed"),
    );
    expect(runtime.next).not.toHaveBeenCalled();
    expect(runtime.close).toHaveBeenCalledOnce();
    expect(
      world.stored.get(run.id)?.steps.find((step) => step.id === "group"),
    ).toMatchObject({
      status: "failed",
      failedStepId: "first",
      error: "plan_group_acceptance_failed",
    });
    expect(
      world.stored.get(run.id)?.steps.find((step) => step.id === "end"),
    ).toMatchObject({ status: "waiting", isBlocked: true });
    expect(
      world.stored.get(run.id)?.steps.find((step) => step.id === "first")
        ?.session?.acceptance?.verdict,
    ).toBe("open");
  },
);

it("blocks the outer successor when the final internal agent fails acceptance", async () => {
  const runtime = executionFixture();
  const world = await groupEngine(runtime.execution);
  const run = await world.engine.start("owner", world.snapshot);
  await vi.waitFor(() => expect(runtime.open).toHaveBeenCalledOnce());
  runtime.first.resolve(groupTurn());
  await vi.waitFor(() => expect(runtime.next).toHaveBeenCalledOnce());
  runtime.second.resolve(groupTurn({ output: "No report" }));
  await vi.waitFor(() =>
    expect(world.stored.get(run.id)?.status).toBe("failed"),
  );
  expect(
    world.stored.get(run.id)?.steps.find((step) => step.id === "group"),
  ).toMatchObject({
    status: "failed",
    failedStepId: "second",
    error: "plan_group_acceptance_failed",
  });
  expect(
    world.stored.get(run.id)?.steps.find((step) => step.id === "end")
      ?.isBlocked,
  ).toBe(true);
});

it.each([
  { name: "native session", change: { sessionId: "different-native-session" } },
  {
    name: "effective model",
    change: { effective: { model: "changed-model" } },
  },
])("fails closed when the adapter changes the $name", async ({ change }) => {
  const runtime = executionFixture();
  const world = await groupEngine(runtime.execution);
  const run = await world.engine.start("owner", world.snapshot);
  await vi.waitFor(() => expect(runtime.open).toHaveBeenCalledOnce());
  runtime.first.resolve(groupTurn());
  await vi.waitFor(() => expect(runtime.next).toHaveBeenCalledOnce());
  runtime.second.resolve(groupTurn(change));
  await vi.waitFor(() =>
    expect(world.stored.get(run.id)?.status).toBe("failed"),
  );
  expect(
    world.stored.get(run.id)?.steps.find((step) => step.id === "group"),
  ).toMatchObject({
    status: "failed",
    failedStepId: "second",
    error: "plan_context_changed",
  });
  expect(
    world.stored.get(run.id)?.steps.find((step) => step.id === "end")
      ?.isBlocked,
  ).toBe(true);
});

it.each([{ name: "provider error", turn: groupTurn({ failure: "failed" }) }])(
  "stops the group and blocks its outer successor after $name",
  async ({ turn }) => {
    const runtime = executionFixture();
    const world = await groupEngine(runtime.execution);
    const run = await world.engine.start("owner", world.snapshot);
    await vi.waitFor(() => expect(runtime.open).toHaveBeenCalledOnce());
    runtime.first.resolve(turn);
    await vi.waitFor(() =>
      expect(world.stored.get(run.id)?.status).toBe("failed"),
    );
    expect(runtime.next).not.toHaveBeenCalled();
    expect(
      world.stored.get(run.id)?.steps.find((step) => step.id === "end")
        ?.isBlocked,
    ).toBe(true);
    expect(
      world.stored.get(run.id)?.steps.find((step) => step.id === "group"),
    ).toMatchObject({ status: "failed", failedStepId: "first" });
  },
);

it("pauses between steps and resumes their order in the retained native session", async () => {
  const runtime = executionFixture();
  const world = await groupEngine(runtime.execution);
  const run = await world.engine.start("owner", world.snapshot);
  await vi.waitFor(() => expect(runtime.open).toHaveBeenCalledOnce());
  await world.engine.pause(run.id);
  runtime.first.resolve(groupTurn());
  await vi.waitFor(() =>
    expect(
      world.stored.get(run.id)?.steps.find((step) => step.id === "first")
        ?.status,
    ).toBe("succeeded"),
  );
  expect(runtime.next).not.toHaveBeenCalled();
  expect(runtime.close).not.toHaveBeenCalled();
  await world.engine.resume(run.id);
  await vi.waitFor(() => expect(runtime.next).toHaveBeenCalledOnce());
  runtime.second.resolve(groupTurn());
  await vi.waitFor(() =>
    expect(world.stored.get(run.id)?.status).toBe("succeeded"),
  );
  expect(runtime.open).toHaveBeenCalledOnce();
});

it.each([false, true])(
  "cancels an active or paused group without starting further agents (paused: %s)",
  async (isPaused) => {
    const runtime = executionFixture();
    const world = await groupEngine(runtime.execution);
    const run = await world.engine.start("owner", world.snapshot);
    await vi.waitFor(() => expect(runtime.open).toHaveBeenCalledOnce());
    if (isPaused) {
      await world.engine.pause(run.id);
      runtime.first.resolve(groupTurn());
      await vi.waitFor(() =>
        expect(
          world.stored.get(run.id)?.steps.find((step) => step.id === "first")
            ?.status,
        ).toBe("succeeded"),
      );
    }
    await world.engine.stop(run.id);
    await vi.waitFor(() =>
      expect(world.stored.get(run.id)?.status).toBe("cancelled"),
    );
    expect(runtime.next).not.toHaveBeenCalled();
    expect(
      world.stored.get(run.id)?.steps.find((step) => step.id === "group")
        ?.status,
    ).toBe("cancelled");
    expect(
      world.stored.get(run.id)?.steps.find((step) => step.id === "end")?.status,
    ).toBe("cancelled");
  },
);

it("cancels the second active agent and keeps the outer successor from starting", async () => {
  const runtime = executionFixture();
  const world = await groupEngine(runtime.execution);
  const run = await world.engine.start("owner", world.snapshot);
  await vi.waitFor(() => expect(runtime.open).toHaveBeenCalledOnce());
  runtime.first.resolve(groupTurn());
  await vi.waitFor(() => expect(runtime.next).toHaveBeenCalledOnce());
  await world.engine.stop(run.id);
  await vi.waitFor(() =>
    expect(world.stored.get(run.id)?.status).toBe("cancelled"),
  );
  expect(
    world.stored.get(run.id)?.steps.find((step) => step.id === "second")
      ?.status,
  ).toBe("cancelled");
  expect(
    world.stored.get(run.id)?.steps.find((step) => step.id === "end")?.status,
  ).toBe("cancelled");
});

it("does not start the first internal agent after an unsuccessful outer predecessor", async () => {
  const runtime = executionFixture();
  const world = await groupEngine(runtime.execution);
  const first = world.snapshot.steps[0];
  if (!first) throw new Error("Missing fixture step");
  const before = {
    ...first,
    groupId: undefined,
    step: { ...first.step, id: "before" },
  };
  const snapshot = {
    ...world.snapshot,
    steps: [before, ...world.snapshot.steps],
    plan: {
      ...world.snapshot.plan,
      nodes: [...world.snapshot.plan.nodes, before.step],
      edges: [
        ...world.snapshot.plan.edges.map((edge) =>
          edge.from === "start" ? { ...edge, from: "before" } : edge,
        ),
        {
          from: "start",
          to: "before",
          fromPort: "flow-out",
          toPort: "flow-in",
        },
      ],
    },
  };
  const run = await world.engine.start("owner", snapshot);
  await vi.waitFor(() => expect(runtime.open).toHaveBeenCalledOnce());
  runtime.first.resolve(groupTurn({ failure: "failed" }));
  await vi.waitFor(() =>
    expect(world.stored.get(run.id)?.status).toBe("failed"),
  );
  expect(runtime.next).not.toHaveBeenCalled();
  expect(runtime.open).toHaveBeenCalledOnce();
  expect(
    world.stored.get(run.id)?.steps.find((step) => step.id === "first"),
  ).toMatchObject({ status: "waiting", isBlocked: true });
});

it("applies the group acceptance gate to TODO-only steps as well", async () => {
  const runtime = executionFixture();
  const world = await groupEngine(runtime.execution);
  const snapshot = {
    ...world.snapshot,
    steps: world.snapshot.steps.map((step) => ({
      ...step,
      step: { ...step.step, completion: "todos" as const },
    })),
  };
  const run = await world.engine.start("owner", snapshot);
  await vi.waitFor(() => expect(runtime.open).toHaveBeenCalledOnce());
  runtime.first.resolve(groupTurn({ output: "Completed without report" }));
  await vi.waitFor(() =>
    expect(world.stored.get(run.id)?.status).toBe("failed"),
  );
  expect(runtime.next).not.toHaveBeenCalled();
  expect(
    world.stored.get(run.id)?.steps.find((step) => step.id === "first")?.error,
  ).toBe("plan_group_acceptance_failed");
});
