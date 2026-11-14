import { afterEach, expect, it, vi } from "vitest";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { adoptLocalPlanRun } from "@/backend/service/agents/AgentPlanEngineAdoption";

import { createSessions } from "../../agents/local/local-sessions-harness";
import { codexControlFixture } from "./page361-control-fixture";

import type { ActivePlanRun } from "@/backend/service/agents/AgentPlanRunState";

vi.mock("@/backend/service/agents/AgentPlanScriptPause", () => ({
  setScriptRunPaused: vi.fn(async () => undefined),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

it.each(["paused", "pausing"] as const)(
  "reattaches a %s Codex run after restart, confirms its freeze and preserves the same attempt",
  async (status) => {
    const fixture = await codexControlFixture();
    const previous = { ...fixture.active.view, status };
    const local = createSessions();
    vi.spyOn(local, "hasRun").mockReturnValue(true);
    vi.spyOn(local, "has").mockReturnValue(true);
    vi.spyOn(local, "unverified").mockReturnValue(new Set());
    const freeze = vi.spyOn(local, "setRunPaused").mockResolvedValue(undefined);
    const active = new Map<string, ActivePlanRun>();
    const restore = vi.fn(async () => undefined);
    const pauseResources = vi.fn();
    const start = vi.fn((restored: ActivePlanRun) => {
      expect(freeze).toHaveBeenCalledWith(previous.id, true);
      expect(restored.view.status).toBe("paused");
      expect(restored.view.steps[0]?.session).toEqual(previous.steps[0]?.session);
    });
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
        resources: { pauseRun: pauseResources, resumeRun: vi.fn() },
        runs: {
          insert: async () => undefined,
          create: async () => undefined,
          find: async () => previous,
          snapshot: async () => fixture.active.snapshot,
          update: fixture.update,
        },
        start: { control: async () => undefined },
        steps: { run: async () => ({}), closeGroups: async () => [], restore },
      },
    });
    expect(adopted).toBe(true);
    expect(start).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledOnce();
    expect(pauseResources).toHaveBeenCalledWith(previous.id);
    expect(fixture.stored()).toMatchObject({
      id: previous.id,
      status: "paused",
      pauseBoundary: { frontierStepIds: ["a", "b", "c"] },
    });
    expect(active.get(previous.id)?.controllers.has("a")).toBe(true);
  },
);
