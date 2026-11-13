import { beforeEach, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { AutomationAgentWorker } from "@/backend/service/automation/AutomationAgentWorker";
import type { AutomationAgentRunner } from "@/backend/service/automation/AutomationAgentWorker";

import type { StoredAutomationAgentJob } from "@/backend/database/repositories/automation/AutomationAgentJobRepository";
import { partialStub } from "../../stub-fixture";

const repositories = vi.hoisted(() => ({
  heads: vi.fn(),
  deliver: vi.fn(),
  finish: vi.fn(),
  interrupted: vi.fn(),
  find: vi.fn(),
  runDeliver: vi.fn(),
}));

vi.mock(
  "@/backend/database/repositories/automation/AutomationAgentJobRepository",
  () => ({
    AutomationAgentJobRepository: class {
      public heads = repositories.heads;
      public deliver = repositories.deliver;
      public finish = repositories.finish;
      public interrupted = repositories.interrupted;
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationRepository",
  () => ({
    AutomationRepository: class {
      public find = repositories.find;
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationRunRepository",
  () => ({
    AutomationRunRepository: class {
      public deliver = repositories.runDeliver;
    },
  }),
);

type RunnerStart = AutomationAgentRunner["start"];

function job(
  fields: Partial<StoredAutomationAgentJob> = {},
): StoredAutomationAgentJob {
  return {
    id: "job-1",
    runId: "run-1",
    automationId: "automation-1",
    agentId: "agent",
    creatorId: "owner",
    kind: "action",
    prompt: "Bericht",
    state: "queued",
    answer: null,
    errorCode: null,
    sessionId: null,
    queuedAt: "2026-03-04T10:00:00.000Z",
    deliveredAt: null,
    completedAt: null,
    ...fields,
  };
}

function worker(start: Mock<RunnerStart>): AutomationAgentWorker {
  return new AutomationAgentWorker({
    database: partialStub<never>({}),
    rules: partialStub<never>({
      account: vi.fn(async () => ({ accountId: "owner" })),
      canUseAgent: vi.fn(async () => true),
    }),
    runner: { start },
    now: () => new Date("2026-03-04T10:00:00.000Z"),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  repositories.deliver.mockResolvedValue(true);
});

it("hands the target chat the automation names to the run of its agent", async () => {
  repositories.find.mockResolvedValue({
    action: {
      type: "agent",
      agentId: "agent",
      instruction: "x",
      chat: "[[Pages Team]]",
    },
  });
  repositories.heads.mockResolvedValue([job()]);
  const start = vi.fn<RunnerStart>(async () => ({
    sessionId: "s",
    answer: Promise.resolve("Fertig"),
  }));
  await worker(start).pass();
  await vi.waitFor(() =>
    expect(repositories.finish).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ state: "completed" }),
    ),
  );
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({
      chat: "[[Pages Team]]",
      runKey: "run-1",
      agentId: "agent",
      creatorId: "owner",
    }),
  );
});

it("runs an automation without a target and every other delivery in the direct chat of its owner", async () => {
  repositories.find.mockResolvedValue({
    action: { type: "agent", agentId: "agent", instruction: "x" },
  });
  const start = vi.fn<RunnerStart>(async () => ({
    sessionId: "s",
    answer: Promise.resolve("Fertig"),
  }));
  repositories.heads.mockResolvedValue([job()]);
  await worker(start).pass();
  await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
  expect(start.mock.calls[0]?.[0]).toMatchObject({ chat: null });
  start.mockClear();
  repositories.heads.mockResolvedValue([
    job({ id: "job-2", kind: "notification" }),
  ]);
  await worker(start).pass();
  await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
  expect(start.mock.calls[0]?.[0]).toMatchObject({ chat: null });
});

it("fails the delivery of a target chat that cannot be resolved with its reason", async () => {
  repositories.find.mockResolvedValue({
    action: {
      type: "agent",
      agentId: "agent",
      instruction: "x",
      chat: "[[Weg]]",
    },
  });
  repositories.heads.mockResolvedValue([job()]);
  const start = vi.fn<RunnerStart>(async () => {
    throw Object.assign(new Error("gone"), { code: "target_chat_not_found" });
  });
  await worker(start).pass();
  await vi.waitFor(() =>
    expect(repositories.finish).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        state: "failed",
        errorCode: "target_chat_not_found",
      }),
    ),
  );
});
