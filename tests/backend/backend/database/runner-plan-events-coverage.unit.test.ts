import { expect, it, vi } from "vitest";

import { RunnerPlanEventRepository } from "@/backend/database/repositories/runner/RunnerPlanEventRepository";

import { partial } from "../../app/lib/service-wiring-fakes";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { RunnerMessage, RunnerState } from "@/definition/RunnerProtocol";

it("reads durable event receipts and returns null for unknown events", async () => {
  const query = vi
    .fn<Database["query"]>()
    .mockResolvedValueOnce([["connection", "session", 3, "digest"]])
    .mockResolvedValueOnce([]);
  const repository = new RunnerPlanEventRepository(
    partial<Database>({ query }),
  );
  await expect(repository.receipt("event")).resolves.toEqual({
    connectionId: "connection",
    sessionId: "session",
    sequence: 3,
    digest: "digest",
  });
  expect(query.mock.calls[0]?.[1]).toEqual({ event_id: "event" });
  await expect(repository.receipt("missing")).resolves.toBeNull();
});

it("persists a validated event digest in the caller's transaction", async () => {
  const execute = vi
    .fn<DatabaseTransaction["execute"]>()
    .mockResolvedValue(undefined);
  const event = partial<Extract<RunnerMessage, { type: "event" }>>({
    sessionId: "session",
    sequence: 3,
    eventId: "event",
  });
  const repository = new RunnerPlanEventRepository(partial<Database>({}));
  await repository.append({ query: vi.fn(), execute }, "connection", {
    event,
    digest: "digest",
  });
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO runner_plan_events"),
    {
      connection_id: "connection",
      session_id: "session",
      sequence: 3,
      event_id: "event",
      event_digest: "digest",
    },
  );
});

it("leaves unbound and already cancelled jobs alone and refuses an unknown run", async () => {
  const query = vi.fn<Database["query"]>();
  const repository = new RunnerPlanEventRepository(
    partial<Database>({ query }),
  );
  const state = partial<RunnerState>({
    jobs: [
      { jobId: "unbound" },
      {
        jobId: "cancelled",
        plan: { runId: "run" },
        cancellation: { requestedAt: "now" },
      },
    ],
  });
  await expect(repository.fenceStoppedRuns(state)).resolves.toEqual(state);
  expect(query).not.toHaveBeenCalled();
  const transaction = {
    query: vi.fn<DatabaseTransaction["query"]>().mockResolvedValue([]),
    execute: vi.fn<DatabaseTransaction["execute"]>(),
  };
  await expect(
    repository.apply(transaction, "missing", (run) => ({ run })),
  ).rejects.toThrow("Unknown runner plan run");
});
