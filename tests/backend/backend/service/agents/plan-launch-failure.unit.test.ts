import { describe, expect, it, vi } from "vitest";

import { failPlanRunStart } from "@/backend/service/agents/AgentPlanEngineLaunch";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { PlanEngineLaunchHost } from "@/backend/service/agents/AgentPlanEngineLaunch";
import type { ActivePlanRun } from "@/backend/service/agents/AgentPlanRunState";

vi.mock("@/backend/logging/Logger", () => ({
  captureLogContext: vi.fn(),
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
  logEvent: vi.fn(),
  withLogContext: vi.fn(),
}));

function fixture(session = false): {
  host: PlanEngineLaunchHost;
  entry: ActivePlanRun;
  release: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  pump: ReturnType<typeof vi.fn>;
} {
  const release = vi.fn().mockResolvedValue(undefined);
  const update = vi.fn().mockResolvedValue(undefined);
  const pump = vi.fn().mockResolvedValue(undefined);
  const entry = partial<ActivePlanRun>({
    view: partial({
      id: "run",
      status: "running",
      endedAt: null,
      steps: [
        partial({
          id: "step",
          status: "waiting",
          session: session ? {} : null,
        }),
      ],
    }),
    snapshot: partial({ steps: [], groups: [] }),
    controllers: new Map(),
    executions: new Set(),
    releaseDefinition: release,
  });
  const host = partial<PlanEngineLaunchHost>({
    active: new Map([["run", entry]]),
    dependencies: partial({ runs: partial({ update }) }),
    pump,
  });
  return { host, entry, release, update, pump };
}

describe("failed plan launch", () => {
  it("ends an unstarted run and releases its definition", async () => {
    const { host, release, update } = fixture();
    await failPlanRunStart(host, "missing");
    await failPlanRunStart(host, "run");
    expect(host.active.has("run")).toBe(false);
    expect(release).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        steps: [
          expect.objectContaining({
            status: "cancelled",
            cancellation: "not_started",
          }),
        ],
      }),
    );
  });

  it("waits for a live session to settle before finalization", async () => {
    const { host, pump, release } = fixture(true);
    await failPlanRunStart(host, "run");
    expect(host.active.has("run")).toBe(true);
    expect(pump).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
  });

  it("retains a failed update as logged failure without throwing", async () => {
    const { host, update } = fixture();
    update.mockRejectedValueOnce(new Error("database"));
    await expect(failPlanRunStart(host, "run")).resolves.toBeUndefined();
  });
});
