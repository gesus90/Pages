import { afterEach, expect, it, vi } from "vitest";

import { AutomationAgentJobRepository } from "@/backend/database/repositories/automation/AutomationAgentJobRepository";
import { AutomationRepository } from "@/backend/database/repositories/automation/AutomationRepository";
import { AutomationRunRepository } from "@/backend/database/repositories/automation/AutomationRunRepository";
import { AutomationRunExecutor } from "@/backend/service/automation/AutomationRunExecutor";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type { StoredAutomationAgentJob } from "@/backend/database/repositories/automation/AutomationAgentJobRepository";
import type { StoredAutomationRun } from "@/backend/database/repositories/automation/AutomationRunRepository";
import type { AutomationRunExecutorDependencies } from "@/backend/service/automation/AutomationRunExecutor";

const RUN = partial<StoredAutomationRun>({
  id: "run",
  automationId: "automation",
  triggerKind: "manual",
  eventType: null,
  triggerData: null,
  queuedAt: "2030-01-01",
  planRunId: null,
});
const AUTOMATION = partial<StoredAutomation>({
  id: "automation",
  creatorId: "owner",
  name: "Job",
  action: { type: "plan", planId: "plan" },
});

function fixture(): {
  executor: AutomationRunExecutor;
  end: ReturnType<typeof vi.fn>;
  startPlan: ReturnType<typeof vi.fn>;
} {
  const end = vi.fn(async () => undefined);
  const startPlan = vi.fn(async () => "plan-run");
  const dependencies = partial<AutomationRunExecutorDependencies>({
    database: {},
    rules: {
      runBlocker: async () => null,
      account: async () => ({ id: "owner", language: "en" }),
      canUseAgent: async () => true,
    },
    ending: { end },
    ports: {
      startPlan,
      planRunStatus: async () => "succeeded",
      runScript: async () => ({
        exitCode: 0,
        failure: null,
        stdout: "done",
        stderr: "",
      }),
    },
    now: () => new Date("2030-01-01T00:00:00Z"),
  });
  return { executor: new AutomationRunExecutor(dependencies), end, startPlan };
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("starts an authorized plan and records its run identity", async () => {
  vi.spyOn(AutomationRepository.prototype, "find").mockResolvedValue(
    AUTOMATION,
  );
  const deliver = vi
    .spyOn(AutomationRunRepository.prototype, "deliver")
    .mockResolvedValue(undefined);
  const { executor, startPlan, end } = fixture();
  await executor.start(RUN);
  expect(startPlan).toHaveBeenCalledWith("owner", "plan");
  expect(deliver).toHaveBeenCalledWith("run", "plan-run");
  expect(end).not.toHaveBeenCalled();
  expect(executor.isExecuting("run")).toBe(false);
});

it("settles a completed plan or missing agent job with a concrete outcome", async () => {
  vi.spyOn(AutomationRepository.prototype, "find").mockResolvedValue(
    AUTOMATION,
  );
  vi.spyOn(AutomationAgentJobRepository.prototype, "forRuns").mockResolvedValue(
    [],
  );
  const { executor, end } = fixture();
  await executor.settle({ ...RUN, planRunId: "plan-run" });
  expect(end).toHaveBeenCalledWith(expect.anything(), {
    outcome: "ok",
    planRunStatus: "succeeded",
    errorCode: null,
  });
  await executor.settle(RUN);
  expect(end).toHaveBeenLastCalledWith(RUN, {
    outcome: "failed",
    errorCode: "interrupted",
  });
});

it("runs a script through its port and records its bounded result", async () => {
  const automation = {
    ...AUTOMATION,
    action: {
      type: "script" as const,
      workspaceId: "workspace",
      interpreterProfileId: "profile",
      content: "echo",
      timeoutSeconds: 10,
    },
  };
  vi.spyOn(AutomationRepository.prototype, "find").mockResolvedValue(
    automation,
  );
  vi.spyOn(AutomationRunRepository.prototype, "deliver").mockResolvedValue(
    undefined,
  );
  const { executor, end } = fixture();
  await executor.start(RUN);
  expect(end).toHaveBeenCalledWith(
    RUN,
    expect.objectContaining({
      outcome: "ok",
      summary: "done",
      output: "done",
      error: null,
    }),
  );
  expect(executor.isExecuting("run")).toBe(false);
});

it("queues an agent action and settles its completed or forbidden job", async () => {
  const automation = {
    ...AUTOMATION,
    action: { type: "agent" as const, agentId: "agent", instruction: "Work" },
  };
  vi.spyOn(AutomationRepository.prototype, "find").mockResolvedValue(
    automation,
  );
  const enqueue = vi
    .spyOn(AutomationAgentJobRepository.prototype, "enqueue")
    .mockResolvedValue(true);
  const jobs = vi.spyOn(AutomationAgentJobRepository.prototype, "forRuns");
  const { executor, end } = fixture();
  await executor.start(RUN);
  expect(enqueue).toHaveBeenCalledWith(
    expect.objectContaining({ runId: "run", agentId: "agent", kind: "action" }),
  );
  jobs.mockResolvedValueOnce([
    partial<StoredAutomationAgentJob>({
      kind: "action",
      state: "completed",
      answer: "\nDone\nMore",
    }),
  ]);
  await executor.settle(RUN);
  expect(end).toHaveBeenLastCalledWith(RUN, {
    outcome: "ok",
    answer: "\nDone\nMore",
    summary: "Done",
  });
  jobs.mockResolvedValueOnce([
    partial<StoredAutomationAgentJob>({
      kind: "action",
      state: "failed",
      errorCode: "forbidden",
    }),
  ]);
  await executor.settle(RUN);
  expect(end).toHaveBeenLastCalledWith(RUN, {
    outcome: "forbidden",
    errorCode: "forbidden",
  });
});
