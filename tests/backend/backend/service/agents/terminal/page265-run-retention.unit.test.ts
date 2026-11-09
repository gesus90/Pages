import { expect, it, vi } from "vitest";

import { AgentPlanExecution } from "@/backend/agents/AgentPlanExecution";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { AgentPlanStepRunner } from "@/backend/service/agents/AgentPlanStepRunner";

function stepRunner(
  removeRun: (runId: string) => Promise<void>,
): AgentPlanStepRunner {
  return new AgentPlanStepRunner({
    start: { prepare: vi.fn() },
    execution: new AgentPlanExecution(
      { run: vi.fn() },
      { open: vi.fn() },
      new AgentOperationRegistry(),
      { requireUser: async () => {} },
    ),
    tasks: { checklist: vi.fn() },
    access: { grant: vi.fn(), revoke: async () => 0 },
    terminals: { removeRun },
  });
}

it("removes the terminal logs of a completed run at once and keeps those of a failed or stopped one", async () => {
  const removeRun = vi.fn(async () => undefined);
  const runner = stepRunner(removeRun);
  await runner.finishPlanRun("run-failed", "failed");
  await runner.finishPlanRun("run-stopped", "cancelled");
  expect(removeRun).not.toHaveBeenCalled();
  await runner.finishPlanRun("run-done", "succeeded");
  expect(removeRun).toHaveBeenCalledExactlyOnceWith("run-done");
});
