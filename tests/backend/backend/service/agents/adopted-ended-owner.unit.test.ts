import { afterEach, describe, expect, it, vi } from "vitest";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { adoptLocalPlanRun } from "@/backend/service/agents/AgentPlanEngineAdoption";
import { adoptedPlanView } from "@/backend/service/agents/AgentPlanAdoptedView";

import { createSessions } from "../../agents/local/local-sessions-harness";
import { codexControlFixture } from "./page361-control-fixture";

import type { LocalSessions } from "@/backend/agents/local/LocalSessions";
import type { ActivePlanRun } from "@/backend/service/agents/AgentPlanRunState";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

vi.mock("@/backend/service/agents/AgentPlanScriptPause", () => ({
  setScriptRunPaused: vi.fn(async () => undefined),
}));
vi.mock("@/backend/service/agents/AgentPlanRecovery", () => ({
  endInterruptedSession: vi.fn(async (step: unknown) => step),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

/** Local sessions in which the owner of the run's first step ended or stayed uncertain. */
function localOf(owner: "ended" | "uncertain"): LocalSessions {
  const local = createSessions();
  vi.spyOn(local, "hasRun").mockReturnValue(false);
  vi.spyOn(local, "has").mockReturnValue(false);
  vi.spyOn(local, "hasEnded").mockReturnValue(owner === "ended");
  vi.spyOn(local, "unverified").mockImplementation(
    () => new Set(owner === "uncertain" ? [instanceOf(fixtureRun)] : []),
  );
  vi.spyOn(local, "setRunPaused").mockResolvedValue(undefined);
  return local;
}

let fixtureRun: AgentPlanRun;

function instanceOf(run: AgentPlanRun): string {
  const instanceId = run.steps[0]?.session?.instanceId;
  if (!instanceId) throw new Error("Missing synthetic session");
  return instanceId;
}

/** The fixture run with its first step changed and the given run status. */
function runWith(
  base: AgentPlanRun,
  status: AgentPlanRun["status"],
  change: Partial<AgentPlanStepResult>,
): AgentPlanRun {
  return {
    ...base,
    status,
    steps: base.steps.map((step, index) =>
      index === 0 ? { ...step, ...change } : step,
    ),
  };
}

async function adoptWith(
  previous: AgentPlanRun,
  local: LocalSessions,
): Promise<{
  readonly adopted: boolean;
  readonly active: Map<string, ActivePlanRun>;
  readonly start: ReturnType<typeof vi.fn>;
}> {
  const fixture = await codexControlFixture();
  const active = new Map<string, ActivePlanRun>();
  const start = vi.fn();
  const adopted = await adoptLocalPlanRun(previous, {
    active,
    writes: new SerialQueue(),
    start,
    track: () => undefined,
    pump: async () => undefined,
    instruction: async () => {
      throw new Error("Unexpected instruction");
    },
    dependencies: {
      localSessions: local,
      resources: { pauseRun: vi.fn(), resumeRun: vi.fn() },
      runs: {
        insert: async () => undefined,
        create: async () => undefined,
        find: async () => previous,
        snapshot: async () => fixture.active.snapshot,
        update: fixture.update,
      },
      start: { control: async () => undefined },
      steps: { run: async () => ({}), closeGroups: async () => undefined },
    },
  });
  return { adopted, active, start };
}

describe("adoption of a paused run whose native owner ended outside Pages", () => {
  it.each([
    { change: { status: "running" } },
    { change: { status: "failed", error: "plan_local_owner_unverified" } },
  ] as const)(
    "restarts a $change.status step whose owner ended and keeps the run resumable",
    async ({ change }) => {
      fixtureRun = (await codexControlFixture()).active.view;
      const previous = runWith(fixtureRun, "paused", change);

      const { adopted, active, start } = await adoptWith(
        previous,
        localOf("ended"),
      );

      const restored = active.get(previous.id);
      expect(adopted).toBe(true);
      expect(restored?.hasPersistenceFailure).toBe(false);
      expect(restored?.view.steps[0]).toEqual({
        id: previous.steps[0]?.id,
        name: previous.steps[0]?.name,
        status: "paused",
        isBlocked: false,
        cancellation: "none",
        output: null,
        error: null,
        ...(previous.steps[0]?.role ? { role: previous.steps[0].role } : {}),
        ...(previous.steps[0]?.groupId
          ? { groupId: previous.steps[0].groupId }
          : {}),
      });
      expect(start).not.toHaveBeenCalled();
    },
  );

  it("still refuses to continue while the owner is only uncertain", async () => {
    fixtureRun = (await codexControlFixture()).active.view;
    const previous = runWith(fixtureRun, "paused", { status: "running" });

    const { active } = await adoptWith(previous, localOf("uncertain"));

    const restored = active.get(previous.id);
    expect(restored?.hasPersistenceFailure).toBe(true);
    expect(restored?.view.steps[0]).toMatchObject({
      status: "failed",
      error: "plan_local_owner_unverified",
    });
  });
});

describe("adoptedPlanView", () => {
  it("lets a loop member whose owner ended wait for the continuation", async () => {
    fixtureRun = (await codexControlFixture()).active.view;
    const fixture = await codexControlFixture();
    const member = {
      ...(fixtureRun.steps[0] ?? fixtureRun.steps[1]),
      status: "failed" as const,
      error: "plan_local_owner_unverified",
    };
    const finished = { ...member, id: "tickets", status: "succeeded" as const };
    const previous: AgentPlanRun = {
      ...fixtureRun,
      status: "paused",
      loops: [
        {
          id: "loop",
          name: "Tickets",
          status: "running",
          count: null,
          sessionPolicy: "fresh",
          condition: null,
          iterations: [
            {
              id: "loop#1",
              number: 1,
              status: "running",
              startedAt: "2026-11-15T14:20:14.000Z",
              endedAt: null,
              nodes: [member, finished],
              condition: { state: "not_evaluated", reason: "incomplete" },
              error: null,
            },
          ],
          sessions: [],
          completion: null,
          cleanup: "not_needed",
          startedAt: "2026-11-15T14:20:14.000Z",
          endedAt: null,
          error: null,
        },
      ],
    };

    const view = adoptedPlanView(
      previous,
      fixture.active.snapshot,
      localOf("ended"),
    );

    const nodes = view.loops?.[0]?.iterations[0]?.nodes;
    expect(nodes?.[0]).toMatchObject({ status: "waiting", error: null });
    expect(nodes?.[0]?.session).toBeUndefined();
    expect(nodes?.[1]).toBe(finished);
  });

  it("never restarts the step of a running run, which startup recovery owns", async () => {
    fixtureRun = (await codexControlFixture()).active.view;
    const fixture = await codexControlFixture();
    const previous = runWith(fixtureRun, "running", {
      status: "failed",
      error: "plan_local_owner_unverified",
    });

    const view = adoptedPlanView(
      previous,
      fixture.active.snapshot,
      localOf("ended"),
    );

    expect(view.steps[0]).toBe(previous.steps[0]);
  });
});
