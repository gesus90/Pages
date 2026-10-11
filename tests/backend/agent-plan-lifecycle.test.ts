import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";

import {
  controlExecution,
  createExecutionPlanHarness,
  executionPlan,
  executionStep,
  waitForPlan,
} from "../helpers/execution-plans";
import { useMigratedDatabase } from "../helpers/test-database";

import type { ExecutionPlanHarness } from "../helpers/execution-plans";

describe("A10 scheduler lifecycle and failure recovery regression", () => {
  const getDatabase = useMigratedDatabase();
  let harness: ExecutionPlanHarness | undefined;
  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });
  async function setup(): Promise<ExecutionPlanHarness> {
    harness = await createExecutionPlanHarness(getDatabase());
    return harness;
  }

  it("returns a safe initial view if the immediate read after starting a persisted run is absent", async () => {
    const current = await setup();
    const id = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId),
    );
    vi.spyOn(current.runRepository, "find").mockResolvedValueOnce(null);
    const run = await current.service.play(current.bob.id, id, 1);
    expect(run).toMatchObject({
      planId: id,
      userId: current.bob.id,
      status: "running",
    });
    await waitForPlan(async () =>
      expect((await current.runRepository.find(run.id))?.status).toBe(
        "succeeded",
      ),
    );
  });

  it("enforces the two-step instance limit across different runs and resumes queued independent work", async () => {
    const current = await setup();
    const pending = controlExecution(current.execution);
    const firstPlan = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId, {
        nodes: [
          executionStep("A", current.agentId),
          executionStep("B", current.agentId),
        ],
      }),
    );
    const secondPlan = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId, {
        nodes: [executionStep("C", current.agentId)],
      }),
    );
    const first = await current.service.play(current.bob.id, firstPlan, 1);
    await waitForPlan(() => expect(pending.size).toBe(2));
    const second = await current.service.play(current.bob.id, secondPlan, 1);
    expect(pending.has("C")).toBe(false);
    pending.get("A")?.resolve("A");
    await waitForPlan(() => expect(pending.has("C")).toBe(true));
    pending.get("B")?.resolve("B");
    pending.get("C")?.resolve("C");
    await waitForPlan(async () =>
      expect((await current.runRepository.find(second.id))?.status).toBe(
        "succeeded",
      ),
    );
    expect((await current.runRepository.find(first.id))?.status).toBe(
      "succeeded",
    );
    await current.engine.stop("removed-run");
    await current.service.shutdown();
    await expect(
      current.service.play(current.bob.id, firstPlan, 1),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
  });

  it("cancels a step awaiting live preparation without calling the adapter or claiming it was started", async () => {
    const current = await setup();
    let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const prepare = current.stepStart.prepare.bind(current.stepStart);
    vi.spyOn(current.stepStart, "prepare").mockImplementation(
      async (...arguments_) => {
        await gate;
        return prepare(...arguments_);
      },
    );
    const id = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId),
    );
    const run = await current.service.play(current.bob.id, id, 1);
    await current.service.stop(current.bob.id, run.id);
    finish?.();
    await waitForPlan(async () =>
      expect((await current.runRepository.find(run.id))?.status).toBe(
        "cancelled",
      ),
    );
    expect(current.execution.run).not.toHaveBeenCalled();
    expect((await current.runRepository.find(run.id))?.steps[0]).toMatchObject({
      status: "cancelled",
      cancellation: "not_started",
    });
  });

  it.each([
    new AgentError("agent_inactive"),
    new TextAssistantError("timeout"),
  ])("preserves the safe typed failure code for %s", async (error) => {
    const current = await setup();
    current.execution.run.mockRejectedValue(error);
    const id = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId),
    );
    const run = await current.service.play(current.bob.id, id, 1);
    await waitForPlan(async () =>
      expect((await current.runRepository.find(run.id))?.status).toBe("failed"),
    );
    expect((await current.runRepository.find(run.id))?.steps[0].error).toBe(
      error.code,
    );
  });

  it("stops further providers and requests cancellation when persistence of active progress fails", async () => {
    const current = await setup();
    const pending = controlExecution(current.execution);
    const id = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId, {
        nodes: [
          executionStep("A", current.agentId),
          executionStep("B", current.agentId),
          executionStep("C", current.agentId),
        ],
        edges: [{ from: "A", to: "C" }],
      }),
    );
    const run = await current.service.play(current.bob.id, id, 1);
    await waitForPlan(() => expect(pending.size).toBe(2));
    const diagnostic = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.spyOn(current.runRepository, "update").mockRejectedValueOnce(
      new Error("synthetic persistence failure"),
    );
    pending.get("A")?.resolve("A");
    await waitForPlan(() => expect(diagnostic).toHaveBeenCalledOnce());
    expect(pending.get("B")?.signal.aborted).toBe(true);
    expect(pending.has("C")).toBe(false);
    pending.get("B")?.reject(new AgentPlanCancelledError());
    await waitForPlan(async () =>
      expect((await current.runRepository.find(run.id))?.status).toBe(
        "cancelled",
      ),
    );
    expect(current.execution.run).toHaveBeenCalledTimes(2);
  });
});
