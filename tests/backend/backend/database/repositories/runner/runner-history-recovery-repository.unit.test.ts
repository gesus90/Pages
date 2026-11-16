import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { RunnerMessage } from "@/definition/RunnerProtocol";

const write = vi.hoisted(() => vi.fn());
vi.mock("@/backend/storage/AgentPayloadFileStore", () => ({
  requireAgentFiles: () => ({ write }),
  readStoredAgentPayload: vi.fn(),
}));

import { RunnerHistoryRecoveryRepository } from "@/backend/database/repositories/runner/RunnerHistoryRecoveryRepository";

const query = vi.fn();
const execute = vi.fn();
const database = partial<Database>({ query, execute });
const repository = new RunnerHistoryRecoveryRepository(database);
const transaction = partial<DatabaseTransaction>({ query, execute });
type PlanEvent = Extract<RunnerMessage, { type: "event" }>;
const event = partial<PlanEvent>({
  eventId: "event",
  sequence: 2,
  job: { jobId: "job", plan: { planId: "plan", runId: "run" } },
  history: [{ sequence: 1, text: "message" }],
});

beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue([]);
  write.mockResolvedValue("packet-file");
});

it("synchronizes a packet before retaining its reference", async () => {
  await expect(
    repository.retain(transaction, "connection", event),
  ).rejects.toThrow("synchronized");
  await repository.prepare(event);
  await repository.retain(transaction, "connection", event);
  expect(write).toHaveBeenCalledWith("plan", JSON.stringify(event));
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO runner_history_recovery"),
    expect.objectContaining({
      event_id: "event",
      packet_file: "packet-file",
      payload_run_id: "run",
    }),
  );
});

it("ignores empty histories and rejects an unbound packet", async () => {
  const empty = partial<PlanEvent>({ job: { jobId: "job" }, history: [] });
  await repository.prepare(empty);
  await repository.retain(transaction, "connection", empty);
  expect(write).not.toHaveBeenCalled();
  await expect(
    repository.prepare(
      partial<PlanEvent>({ job: { jobId: "job" }, history: [{ sequence: 1 }] }),
    ),
  ).rejects.toThrow("binding missing");
});

it("reports pending custody without exposing packet content", async () => {
  query
    .mockResolvedValueOnce([["connection"]])
    .mockResolvedValueOnce([["event"]])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([[2]]);
  expect(await repository.pendingConnections()).toEqual(["connection"]);
  expect(await repository.hasPending("connection")).toBe(true);
  expect(await repository.isPending("event")).toBe(false);
  expect(await repository.pendingCount("job")).toBe(2);
});
