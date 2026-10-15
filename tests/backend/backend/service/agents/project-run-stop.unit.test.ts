import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

type Dependencies = ConstructorParameters<typeof AgentPlanRunEngine>[0];
interface StepOptions {
  readonly signal: AbortSignal;
}

const WORKSPACE = {
  id: "workspace",
  path: "/work",
  directoryIdentity: "identity",
  revision: 1,
  projectId: "project",
  github: null,
} as const;

/** A plan of one agent node between start and end, owned by the given project. */
function snapshotOf(projectId: string, planId: string): AgentPlanSnapshot {
  const position = { x: 0, y: 0 };
  const template = emptyAgentConfiguration();
  return {
    plan: {
      id: planId,
      ownerId: "owner",
      projectId,
      workspaceId: WORKSPACE.id,
      name: planId,
      usage: "private",
      globals: {},
      revision: 1,
      nodes: [
        { id: "start", type: "start", ...position },
        {
          id: "agent",
          type: "agent",
          agentId: "agent",
          personalAgentId: null,
          instruction: "",
          bindings: {},
          ...position,
        },
        { id: "end", type: "end", ...position },
      ],
      edges: [
        { from: "start", to: "agent", fromPort: "out", toPort: "in" },
        { from: "agent", to: "end", fromPort: "out", toPort: "in" },
      ],
    },
    steps: [
      {
        step: {
          id: "agent",
          type: "agent",
          agentId: "agent",
          personalAgentId: null,
          instruction: "",
          bindings: {},
          ...position,
        },
        name: "Agent",
        revision: 1,
        template: {
          markdown: template.markdown,
          parameters: template.parameters,
          directoryParameter: template.directoryParameter,
          run: template.run,
        },
        provider: "openrouter",
        model: "model",
        reasoningEffort: null,
        prepared: {
          parameters: {
            markdown: "",
            directory: null,
            values: {},
            wikiVersions: {},
            tickets: {},
            assetInputs: [],
          },
          workspace: { ...WORKSPACE, projectId },
          directory: null,
          references: [],
          wiki: {},
        },
        taskIds: [],
        taskVersions: {},
      },
    ],
  };
}

interface Harness {
  readonly engine: AgentPlanRunEngine;
  /** The final view of every run that has closed, by plan. */
  readonly closed: Map<string, AgentPlanRun>;
  /** Resolves once the agent node of a plan has been handed to the runner. */
  readonly started: (planId: string) => Promise<void>;
  /** Makes the agent node of a plan finish, as if its process ended by itself. */
  readonly finish: (planId: string) => void;
}

/**
 * The engine around a runner that honors a stop request unless a test says it does not.
 * Persistence, the node runner and the archive are replaced by recorders.
 */
function harness(ignoresStop: readonly string[] = []): Harness {
  const closed = new Map<string, AgentPlanRun>();
  const running = new Set<string>();
  const finishers = new Map<string, () => void>();
  const dependencies = {
    runs: {
      create: vi.fn(async () => {}),
      update: vi.fn(async (run: AgentPlanRun) => {
        if (run.status !== "running" && run.status !== "paused")
          closed.set(run.planId, run);
      }),
      find: vi.fn(async () => null),
    },
    start: { control: vi.fn(async () => {}) },
    steps: {
      run: vi.fn(
        (
          run: AgentPlanRun,
          snapshot: AgentPlanSnapshot,
          step: unknown,
          options: StepOptions,
        ) =>
          new Promise<Partial<AgentPlanStepResult>>((resolve) => {
            const planId = snapshot.plan.id;
            running.add(planId);
            finishers.set(planId, () =>
              resolve({ status: "succeeded", output: null, error: null }),
            );
            if (ignoresStop.includes(planId)) return;
            options.signal.addEventListener("abort", () =>
              resolve({ status: "cancelled", cancellation: "confirmed" }),
            );
          }),
      ),
    },
    archive: { complete: vi.fn(async () => {}) },
    files: { hold: vi.fn(async () => async () => {}) },
  };
  return {
    // The engine only calls the members given above on its collaborators.
    engine: new AgentPlanRunEngine(dependencies as unknown as Dependencies),
    closed,
    started: (planId) => vi.waitFor(() => expect(running).toContain(planId)),
    finish: (planId) => finishers.get(planId)?.(),
  };
}

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("AgentPlanRunEngine.stopProject", () => {
  it("stops the runs of the project and returns once they have closed and are recorded", async () => {
    const { engine, closed, started } = harness();
    await engine.start("owner", snapshotOf("project-a", "plan-a"));
    await started("plan-a");
    await expect(engine.stopProject("project-a")).resolves.toBe(true);
    expect(closed.get("plan-a")).toMatchObject({
      status: "cancelled",
      stopRequested: true,
    });
  });

  it("leaves the runs of other projects running and does not wait for them", async () => {
    const { engine, closed, finish, started } = harness();
    await engine.start("owner", snapshotOf("project-a", "plan-a"));
    await engine.start("owner", snapshotOf("project-b", "plan-b"));
    await Promise.all([started("plan-a"), started("plan-b")]);
    await expect(engine.stopProject("project-a")).resolves.toBe(true);
    expect([...closed.keys()]).toEqual(["plan-a"]);
    finish("plan-b");
    await engine.shutdown();
  });

  it("finds nothing to stop for a project without active runs", async () => {
    const { engine, closed } = harness();
    await expect(engine.stopProject("project-a")).resolves.toBe(true);
    expect(closed.size).toBe(0);
  });

  it("gives up waiting for a run that does not close and says so", async () => {
    const { engine, finish, started } = harness(["plan-a"]);
    await engine.start("owner", snapshotOf("project-a", "plan-a"));
    await started("plan-a");
    vi.useFakeTimers();
    const stopping = engine.stopProject("project-a");
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(stopping).resolves.toBe(false);
    vi.useRealTimers();
    finish("plan-a");
  });
});
