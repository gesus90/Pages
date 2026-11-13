import { beforeEach, expect, it, vi } from "vitest";

import { AgentPlanSkippedStepError } from "@/backend/error/AgentErrors";
import {
  preparePlanContinuation,
  prepareRecoveredPlan,
} from "@/backend/service/agents/AgentPlanContinuation";
import { dispatchPlanLocalNode } from "@/backend/service/agents/AgentPlanNodeDispatch";
import { dispatchPlanScript } from "@/backend/service/agents/AgentPlanScriptDispatch";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";

import { recoveryFixture } from "./page84-recovery-fixture";

import type { PlanNodeDispatchContext } from "@/backend/service/agents/AgentPlanNodeDispatch";
import type { ActivePlanRun } from "@/backend/service/agents/AgentPlanRunState";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";

vi.mock("@/backend/service/agents/AgentPlanScriptDispatch", () => ({
  dispatchPlanScript: vi.fn(),
}));

const FLOW = { fromPort: "flow-out", toPort: "flow-in" } as const;

/** Both entry points run the same boundary check; each test names the one it uses. */
const ENTRY_POINTS = [
  {
    name: "Fortsetzen",
    adopt: (
      run: AgentPlanRun,
      previous: AgentPlanSnapshot,
      next: AgentPlanSnapshot,
    ): AgentPlanSnapshot =>
      preparePlanContinuation(run, previous, next).snapshot,
  },
  {
    name: "Wiederherstellen",
    adopt: (
      run: AgentPlanRun,
      previous: AgentPlanSnapshot,
      next: AgentPlanSnapshot,
    ): AgentPlanSnapshot => prepareRecoveredPlan(run, previous, next),
  },
] as const;

function prepareScript(disabled: boolean): AgentPlanScript {
  return {
    id: "prepare",
    type: "script",
    name: "prepare",
    x: 0,
    y: 0,
    interpreterProfileId: "synthetic-shell",
    content: "echo prepared",
    inputs: [],
    outputs: [{ name: "branch", type: "text" }],
    timeoutSeconds: 10,
    ...(disabled ? { disabled: true } : {}),
    bindings: {},
  };
}

/** The frozen A → B → C plan of the recovery fixture behind a `prepare` script. */
async function scriptedPlan(isPrepareDisabled: boolean): Promise<{
  readonly snapshot: AgentPlanSnapshot;
  readonly run: AgentPlanRun;
}> {
  const fixture = await recoveryFixture();
  const snapshot: AgentPlanSnapshot = {
    ...fixture.snapshot,
    plan: {
      ...fixture.snapshot.plan,
      nodes: [prepareScript(isPrepareDisabled), ...fixture.snapshot.plan.nodes],
      edges: [
        { from: "prepare", to: "a", ...FLOW },
        ...fixture.snapshot.plan.edges,
      ],
    },
  };
  return { snapshot, run: fixture.completed };
}

/** A run paused after `prepare` and A, with `prepare` as it ended in this run. */
function pausedAfter(
  run: AgentPlanRun,
  prepare: Partial<AgentPlanStepResult>,
): AgentPlanRun {
  const prepareResult: AgentPlanStepResult = {
    id: "prepare",
    name: "prepare",
    status: "succeeded",
    isBlocked: false,
    cancellation: "none",
    output: "",
    error: null,
    ...prepare,
  };
  return {
    ...run,
    status: "paused",
    stopRequested: false,
    steps: [prepareResult, ...run.steps],
    pauseBoundary: {
      pausedAt: "2026-11-12T00:00:00.000Z",
      completedStepIds: ["prepare", "a"],
      pendingStepIds: ["b", "c"],
      frontierStepIds: ["b"],
    },
  };
}

function withPrepare(
  snapshot: AgentPlanSnapshot,
  disabled: boolean,
): AgentPlanSnapshot {
  return {
    ...snapshot,
    plan: {
      ...snapshot.plan,
      revision: snapshot.plan.revision + 1,
      nodes: snapshot.plan.nodes.map((node) =>
        node.id === "prepare" ? prepareScript(disabled) : node,
      ),
    },
  };
}

function refusal(action: () => unknown): unknown {
  try {
    action();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("The continuation was not refused.");
}

beforeEach(() => {
  vi.mocked(dispatchPlanScript).mockReset();
});

it.each(ENTRY_POINTS)(
  "$name refuses a skipped script that is enabled again and changes nothing",
  async ({ adopt }) => {
    const { snapshot, run } = await scriptedPlan(true);
    const paused = pausedAfter(run, { skipped: true });
    const enabled = withPrepare(snapshot, false);
    const runBefore = structuredClone(paused);
    const enabledBefore = structuredClone(enabled);

    const error = refusal(() => adopt(paused, snapshot, enabled));

    expect(error).toBeInstanceOf(AgentPlanSkippedStepError);
    expect(error).toMatchObject({
      code: "plan_skipped_step_enabled",
      nodeId: "prepare",
    });
    expect(paused).toEqual(runBefore);
    expect(enabled).toEqual(enabledBefore);
  },
);

it.each(ENTRY_POINTS)(
  "$name takes over a skipped script that stays disabled",
  async ({ adopt }) => {
    const { snapshot, run } = await scriptedPlan(true);
    const paused = pausedAfter(run, { skipped: true });

    const adopted = adopt(paused, snapshot, withPrepare(snapshot, true));

    expect(adopted.plan.nodes.find((node) => node.id === "prepare")).toEqual(
      prepareScript(true),
    );
  },
);

it("keeps the skipped result of a script that stays disabled when a paused run goes on", async () => {
  const { snapshot, run } = await scriptedPlan(true);
  const paused = pausedAfter(run, { skipped: true });

  const next = preparePlanContinuation(
    paused,
    snapshot,
    withPrepare(snapshot, true),
  );

  expect(next.run.status).toBe("running");
  expect(next.run.steps.find((step) => step.id === "prepare")).toMatchObject({
    status: "succeeded",
    skipped: true,
  });
  expect(next.run.steps.find((step) => step.id === "a")?.status).toBe(
    "succeeded",
  );
  expect(next.run.steps.find((step) => step.id === "b")?.status).toBe(
    "waiting",
  );
});

it.each(ENTRY_POINTS)(
  "$name takes over a script that really ran and the agents, whether the script stays enabled or is disabled now",
  async ({ adopt }) => {
    const { snapshot, run } = await scriptedPlan(false);
    const paused = pausedAfter(run, { output: "work/branch" });

    for (const disabled of [false, true]) {
      const adopted = adopt(paused, snapshot, withPrepare(snapshot, disabled));

      // Completed nodes keep their frozen contracts, the agents included.
      expect(adopted.steps.map((step) => step.step.id)).toEqual([
        "a",
        "b",
        "c",
      ]);
    }
  },
);

it.each(ENTRY_POINTS)(
  "$name ignores a skipped result of a node that is no completed step",
  async ({ adopt }) => {
    const { snapshot, run } = await scriptedPlan(true);
    const paused = pausedAfter(run, { skipped: true });
    const pending: AgentPlanRun = {
      ...paused,
      pauseBoundary: {
        pausedAt: "2026-11-12T00:00:00.000Z",
        completedStepIds: ["a"],
        pendingStepIds: ["prepare", "b", "c"],
        frontierStepIds: ["b"],
      },
    };

    expect(() =>
      adopt(pending, snapshot, withPrepare(snapshot, false)),
    ).not.toThrow();
  },
);

it("runs an enabled script of a new run as a process and skips only a disabled one", async () => {
  const { snapshot, run } = await scriptedPlan(false);
  vi.mocked(dispatchPlanScript).mockResolvedValue({
    status: "succeeded",
    output: "work/branch",
  });
  const active: ActivePlanRun = {
    groupCloseout: "open",
    hasPersistenceFailure: false,
    view: run,
    snapshot,
    dispatched: new Set(["prepare"]),
    controllers: new Map(),
    executions: new Set(),
  };
  const context: PlanNodeDispatchContext = {
    writes: new SerialQueue(),
    // The script process itself is mocked; these boundaries must stay untouched.
    dependencies: {
      runs: {
        insert: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        find: vi.fn(),
      },
      start: { control: vi.fn() },
    },
  };

  const ran = await dispatchPlanLocalNode(
    active,
    prepareScript(false),
    new AbortController(),
    context,
  );
  const skipped = await dispatchPlanLocalNode(
    active,
    prepareScript(true),
    new AbortController(),
    context,
  );

  expect(dispatchPlanScript).toHaveBeenCalledTimes(1);
  expect(vi.mocked(dispatchPlanScript).mock.calls[0]?.[1]).toBe("prepare");
  expect(ran).toEqual({ status: "succeeded", output: "work/branch" });
  expect(ran).not.toHaveProperty("skipped");
  expect(skipped).toMatchObject({ status: "succeeded", skipped: true });
});
