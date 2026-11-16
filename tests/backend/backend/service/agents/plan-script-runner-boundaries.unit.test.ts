import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";
import { AgentPlanScriptRunner } from "@/backend/service/agents/AgentPlanScriptRunner";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { Mock } from "vitest";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanScriptRun } from "@/definition/AgentPlanScript";
import type {
  AgentPlanScriptPreparation,
  AgentPlanScriptSnapshot,
} from "@/backend/service/agents/AgentPlanScriptPreparation";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  remove: vi.fn(),
  execute: vi.fn(),
  removeStep: vi.fn(),
}));
vi.mock("@/backend/service/agents/AgentPlanScriptResources", () => ({
  createScriptResources: mocks.create,
  removeScriptResources: mocks.remove,
  scriptRuntimeDirectory: vi.fn().mockReturnValue("/virtual"),
}));
vi.mock("@/backend/service/agents/AgentPlanScriptOwner", () => ({
  executeOwnedScript: mocks.execute,
}));
vi.mock("@/backend/agents/PlanRunTemporaryDirectory", () => ({
  removePlanTemporaryStep: mocks.removeStep,
}));

const run = partial<AgentPlanRun>({ id: "run", userId: "u", steps: [] });
const snapshot = partial<AgentPlanSnapshot>({ plan: partial({}) });
const script = partial<AgentPlanScriptSnapshot>({
  step: partial({
    id: "step",
    bindings: {},
    inputs: [],
    outputs: [],
    content: "code",
    timeoutSeconds: 1,
  }),
  interpreter: partial({ id: "interpreter", path: "/virtual/node" }),
  workspace: partial({ path: "/virtual/work" }),
  inputs: {},
  taskIds: [],
});

function fixture(): {
  runner: AgentPlanScriptRunner;
  reauthorize: ReturnType<typeof vi.fn>;
  save: Mock<(record: AgentPlanScriptRun) => Promise<void>>;
  signal: AbortSignal;
} {
  const reauthorize = vi.fn().mockResolvedValue(undefined);
  const preparation = partial<AgentPlanScriptPreparation>({
    reauthorize,
    readTask: vi.fn(),
  });
  return {
    runner: new AgentPlanScriptRunner(preparation, "/virtual"),
    reauthorize,
    save: vi
      .fn<(record: AgentPlanScriptRun) => Promise<void>>()
      .mockResolvedValue(undefined),
    signal: new AbortController().signal,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue("/virtual/resources");
  mocks.remove.mockResolvedValue(undefined);
  mocks.removeStep.mockResolvedValue(undefined);
  mocks.execute.mockImplementation(
    async (input: { record: AgentPlanScriptRun }) => ({
      ...input.record,
      closeout: "confirmed",
      failure: null,
    }),
  );
});

describe("plan script runner boundaries", () => {
  it("records and completes a script without starting a real process", async () => {
    const { runner, reauthorize, save, signal } = fixture();
    const result = await runner.run(run, snapshot, script, {
      signal,
      save,
      claimStart: vi.fn(),
    });
    expect(result).toMatchObject({
      status: "succeeded",
      cancellation: "none",
      output: null,
    });
    expect(reauthorize).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.removeStep).toHaveBeenCalledOnce();
  });

  it("reports authorization failures before process creation", async () => {
    const { runner, reauthorize, save, signal } = fixture();
    reauthorize.mockRejectedValueOnce(new AgentError("plan_conflict"));
    await expect(
      runner.run(run, snapshot, script, { signal, save, claimStart: vi.fn() }),
    ).resolves.toMatchObject({ status: "failed", error: "plan_conflict" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("reports paused, cancelled and cleanup failure states", async () => {
    const { runner, save, signal } = fixture();
    mocks.execute.mockRejectedValueOnce(new AgentPlanPausedError());
    await expect(
      runner.run(run, snapshot, script, { signal, save, claimStart: vi.fn() }),
    ).resolves.toMatchObject({ status: "paused" });
    mocks.execute.mockRejectedValueOnce(new Error("spawn"));
    mocks.remove.mockRejectedValueOnce(new Error("cleanup"));
    await expect(
      runner.run(run, snapshot, script, { signal, save, claimStart: vi.fn() }),
    ).resolves.toMatchObject({
      status: "failed",
      error: "plan_script_cleanup",
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      runner.run(run, snapshot, script, {
        signal: controller.signal,
        save,
        claimStart: vi.fn(),
      }),
    ).resolves.toMatchObject({
      status: "cancelled",
      cancellation: "not_started",
    });
  });
});
