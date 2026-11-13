import { beforeEach, expect, it, vi } from "vitest";

import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { PlanRunCommandRepository } from "@/backend/database/repositories/agent/PlanRunCommandRepository";
import { AgentError } from "@/backend/error/AgentErrors";
import { logEvent, withLogContext } from "@/backend/logging/Logger";
import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { PlanRunCommandWorker } from "@/backend/service/agents/runs/PlanRunCommandWorker";
import { emptyPlanLoop } from "@/definition/AgentPlanLoop";
import {
  beginIteration,
  initialLoopRun,
} from "@/backend/service/agents/loop/AgentPlanLoopRecord";

import { planRun, stub } from "./agent-plan-service-harness";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { PlanRunCommandAction } from "@/definition/PagesRuns";
import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import type { AgentPlanRemoteExecution } from "@/backend/service/agents/AgentPlanRemoteExecution";
import type { MockInstance } from "vitest";

vi.mock("@/backend/service/agents/runs/RunsSocket", () => ({
  RunsSocket: vi.fn(function () {
    return { listen: vi.fn(), close: vi.fn() };
  }),
}));
vi.mock("@/backend/logging/Logger", () => ({
  captureLogContext: vi.fn(() => ({})),
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
  withLogContext: vi.fn((context: unknown, operation: () => unknown) => {
    void context;
    return operation();
  }),
}));

beforeEach(() => vi.clearAllMocks());

interface CommandMocks {
  readonly failed: MockInstance<PlanRunCommandRepository["failed"]>;
  readonly delivered: MockInstance<PlanRunCommandRepository["delivered"]>;
}

function mockCommand(
  run: AgentPlanRun,
  options: {
    readonly action?: PlanRunCommandAction;
    readonly isPayloadUnreadable?: boolean;
  },
): CommandMocks {
  vi.spyOn(PlanRunCommandRepository.prototype, "pending")
    .mockResolvedValueOnce([
      {
        receipt: {
          id: "command",
          runId: run.id,
          action: options.action ?? "start",
          status: "accepted",
          acceptedAt: run.startedAt,
        },
        snapshotFile: null,
      },
    ])
    .mockResolvedValue([]);
  vi.spyOn(PlanRunCommandRepository.prototype, "hasAccepted").mockResolvedValue(
    false,
  );
  vi.spyOn(PlanRunCommandRepository.prototype, "latest").mockResolvedValue(
    null,
  );
  const readSnapshot = vi
    .spyOn(PlanRunCommandRepository.prototype, "readSnapshot")
    .mockResolvedValue(undefined);
  if (options.isPayloadUnreadable)
    readSnapshot.mockRejectedValue(new Error("Unreadable payload"));
  const failed = vi
    .spyOn(PlanRunCommandRepository.prototype, "failed")
    .mockResolvedValue(undefined);
  const delivered = vi
    .spyOn(PlanRunCommandRepository.prototype, "delivered")
    .mockResolvedValue(undefined);
  vi.spyOn(PlanRunCommandRepository.prototype, "applied").mockResolvedValue(
    undefined,
  );
  return { failed, delivered };
}

async function consume(
  options: {
    readonly action?: PlanRunCommandAction;
    readonly error?: string;
    readonly isPayloadUnreadable?: boolean;
    readonly run?: AgentPlanRun;
  } = {},
): Promise<{
  readonly update: MockInstance<AgentPlanRunRepository["update"]>;
  readonly failed: MockInstance<PlanRunCommandRepository["failed"]>;
  readonly delivered: MockInstance<PlanRunCommandRepository["delivered"]>;
}> {
  const run =
    options.run ??
    planRun({
      steps: [
        {
          id: "node",
          name: "Prepare E2E",
          status: "waiting",
          isBlocked: false,
          cancellation: "none",
          output: null,
          error: null,
        },
      ],
    });
  const transaction = stub<DatabaseTransaction>({ execute: vi.fn() });
  const database = stub<Database>({
    transaction: async (
      operation: (transaction: DatabaseTransaction) => Promise<void>,
    ) => operation(transaction),
  });
  vi.spyOn(AgentPlanRunRepository.prototype, "find").mockResolvedValue(run);
  const update = vi
    .spyOn(AgentPlanRunRepository.prototype, "update")
    .mockImplementation(async (view, checkpoint, continuation, journal) => {
      void checkpoint;
      void continuation;
      await journal?.(transaction, view);
    });
  const { failed, delivered } = mockCommand(run, options);
  const adopt = vi.fn(async () => {
    if (options.error) throw new AgentError("profile_invalid");
    return true;
  });
  const engine = stub<AgentPlanRunEngine>({
    reconcileRetiredRuns: vi.fn(),
    isActive: () => false,
    adopt,
    activateScheduling: vi.fn(),
    pause: adopt,
  });
  const worker = new PlanRunCommandWorker(
    database,
    engine,
    stub<AgentPlanRemoteExecution>({}),
    "/mock-socket",
  );
  await worker.start();
  await worker.stop();
  return { update, failed, delivered };
}

it("settles a profile_invalid start atomically as failed, cancels waiting steps and logs the reason under the run", async () => {
  const { update, failed, delivered } = await consume({
    error: "profile_invalid",
  });
  expect(update).toHaveBeenCalledOnce();
  const persisted = update.mock.calls[0]?.[0];
  expect(persisted).toMatchObject({
    status: "failed",
    startError: "profile_invalid",
    steps: [
      { status: "cancelled", cancellation: "not_started", isBlocked: false },
    ],
  });
  expect(typeof persisted?.endedAt).toBe("string");
  expect(readPlanRun(persisted)).toHaveProperty(
    "startError",
    "profile_invalid",
  );
  expect(failed).toHaveBeenCalledWith(
    "command",
    "profile_invalid",
    expect.any(Object),
  );
  expect(delivered).not.toHaveBeenCalled();
  expect(withLogContext).toHaveBeenCalledWith(
    { runId: "run-1" },
    expect.any(Function),
  );
  const event = vi.mocked(logEvent).mock.calls[0]?.[0];
  expect(event).toMatchObject({
    level: "error",
    event: "agent.run.completed",
    metadata: { status: "failed", code: "profile_invalid" },
  });
  expect(event?.message).toContain("profile_invalid");
});

it("also closes a start with an unreadable queued payload", async () => {
  const { update, failed } = await consume({ isPayloadUnreadable: true });
  expect(update.mock.calls[0]?.[0]).toMatchObject({
    status: "failed",
    startError: "plan_run_unreadable",
  });
  expect(failed).toHaveBeenCalledOnce();
});

it("closes pending loop iterations and their waiting members when a queued start fails", async () => {
  const loop = emptyPlanLoop("loop", "Prepare E2E", { x: 0, y: 0 });
  const pending = beginIteration(initialLoopRun(loop), loop, new Map(), [
    "nested",
  ]);
  const run = planRun({
    steps: pending.iterations.flatMap((iteration) =>
      iteration.nodes.map((node) => ({ ...node, id: "outer" })),
    ),
    loops: [{ ...pending, status: "paused" }],
  });
  const { update } = await consume({ error: "profile_invalid", run });
  const failed = update.mock.calls[0]?.[0];

  expect(failed).toMatchObject({
    status: "failed",
    loops: [
      {
        status: "cancelled",
        error: "profile_invalid",
        iterations: [
          {
            status: "cancelled",
            error: "profile_invalid",
            nodes: [
              {
                status: "cancelled",
                cancellation: "not_started",
                isBlocked: false,
              },
            ],
          },
        ],
      },
    ],
  });
  expect(typeof failed?.loops?.[0]?.endedAt).toBe("string");
  expect(typeof failed?.loops?.[0]?.iterations[0]?.endedAt).toBe("string");
  expect(readPlanRun(failed).loops?.[0]?.iterations[0]).toMatchObject({
    status: "cancelled",
    error: "profile_invalid",
    nodes: [{ status: "cancelled", cancellation: "not_started" }],
  });
});

it("keeps a valid start applied and leaves its run unchanged", async () => {
  const { update, failed, delivered } = await consume();
  expect(update).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
  expect(delivered).toHaveBeenCalledWith("command");
});

it("does not turn a rejected pause into a failed start", async () => {
  const { update, failed } = await consume({
    action: "pause",
    error: "profile_invalid",
  });
  expect(update).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledWith("command", "profile_invalid");
});

it("preserves a terminal run when a stale start is rejected", async () => {
  const { update } = await consume({
    isPayloadUnreadable: true,
    run: planRun({ status: "cancelled" }),
  });
  expect(update).not.toHaveBeenCalled();
});
