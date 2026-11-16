import { expect, it, vi } from "vitest";

import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { RunnerPlanEventService } from "@/backend/service/runner/RunnerPlanEventService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { RunnerPlanEventRepository } from "@/backend/database/repositories/runner/RunnerPlanEventRepository";
import type { RunnerMessage, RunnerState } from "@/definition/RunnerProtocol";

const MESSAGE = partial<Extract<RunnerMessage, { type: "event" }>>({
  type: "event",
  eventId: "event",
  sessionId: "session",
  sequence: 2,
  job: { jobId: "job", status: "running" },
});
const STATE = partial<RunnerState>({
  sessionId: "session",
  sequence: 2,
  jobs: [],
});

it("acknowledges an identical receipt and reports deferred history", async () => {
  const isPending = vi.fn(async () => false);
  const receipt = vi.fn(async () => ({
    connectionId: "connection",
    sessionId: "session",
    sequence: 2,
    digest: planContentDigest(MESSAGE),
  }));
  const repository = partial<RunnerPlanEventRepository>({
    receipt,
    history: { isPending },
  });
  const service = new RunnerPlanEventService(repository, partial({}), {
    shouldRecoverHistory: false,
  });
  await expect(service.replay("connection", STATE, MESSAGE)).resolves.toEqual({
    version: 1,
    type: "ack",
    eventId: "event",
    sequence: 2,
  });
  isPending.mockResolvedValue(true);
  await expect(
    service.replay("connection", STATE, MESSAGE),
  ).resolves.toMatchObject({ type: "history-deferred" });
  await expect(service.replay("other", STATE, MESSAGE)).rejects.toThrow(
    "Conflicting runner event",
  );
  await expect(
    service.replay("connection", { ...STATE, sequence: 1 }, MESSAGE),
  ).rejects.toThrow("Conflicting runner event");
});

it("does not replay absent receipts or non-event messages", async () => {
  const receipt = vi.fn(async () => null);
  const service = new RunnerPlanEventService(
    partial<RunnerPlanEventRepository>({ receipt, history: {} }),
    partial({}),
    { shouldRecoverHistory: false },
  );
  await expect(
    service.replay("connection", STATE, MESSAGE),
  ).resolves.toBeNull();
  await expect(
    service.replay(
      "connection",
      STATE,
      partial<RunnerMessage>({ type: "stop-result" }),
    ),
  ).resolves.toBeNull();
  expect(receipt).toHaveBeenCalledTimes(1);
});

it("prepares event history without preparing other message types", async () => {
  const prepare = vi.fn(async () => {});
  const service = new RunnerPlanEventService(
    partial<RunnerPlanEventRepository>({ history: { prepare } }),
    partial({}),
    { shouldRecoverHistory: false },
  );
  await service.prepareHistory(MESSAGE);
  await service.prepareHistory(partial<RunnerMessage>({ type: "stop-result" }));
  expect(prepare).toHaveBeenCalledOnce();
  expect(prepare).toHaveBeenCalledWith(MESSAGE);
});

it.each([
  { sessionId: "other", sequence: 2, digest: planContentDigest(MESSAGE) },
  { sessionId: "session", sequence: 1, digest: planContentDigest(MESSAGE) },
  { sessionId: "session", sequence: 2, digest: "different" },
])("rejects a conflicting historical receipt", async (receiptFields) => {
  const service = new RunnerPlanEventService(
    partial<RunnerPlanEventRepository>({
      receipt: async () => ({ connectionId: "connection", ...receiptFields }),
      history: {},
    }),
    partial({}),
    { shouldRecoverHistory: false },
  );
  await expect(service.replay("connection", STATE, MESSAGE)).rejects.toThrow(
    "Conflicting runner event",
  );
});

it("defers pending history and releases a previously deferred acknowledgement", async () => {
  const isPending = vi.fn(async () => true);
  const service = new RunnerPlanEventService(
    partial<RunnerPlanEventRepository>({
      history: {
        isPending,
        restore: async () => 0,
        hasPending: async () => false,
      },
    }),
    partial({}),
    { shouldRecoverHistory: false },
  );
  const reply = {
    version: 1 as const,
    type: "ack" as const,
    eventId: "event",
    sequence: 2,
  };
  await expect(
    service.restoreHistory("connection", MESSAGE, reply),
  ).resolves.toEqual({
    ...reply,
    type: "history-deferred",
  });
  isPending.mockResolvedValue(false);
  await expect(
    service.restoreHistory("connection", MESSAGE, {
      ...reply,
      type: "history-deferred",
    }),
  ).resolves.toEqual(reply);
});
