import { beforeEach, expect, it, vi } from "vitest";

import { clearProcessedTicketEntries } from "./AgentPlanProcessedTickets";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";

const mocks = vi.hoisted(() => ({
  readPlanSnapshot: vi.fn(),
  processedTicketEntries: vi.fn(),
  withoutProcessedTicketEntries: vi.fn(),
  recordPlanChange: vi.fn(),
  logCaughtError: vi.fn(),
}));

vi.mock("@/backend/service/agents/AgentPlanSnapshot", () => ({
  readPlanSnapshot: mocks.readPlanSnapshot,
}));
vi.mock("@/backend/service/agents/stack/AgentPlanStackCleanup", () => ({
  processedTicketEntries: mocks.processedTicketEntries,
  withoutProcessedTicketEntries: mocks.withoutProcessedTicketEntries,
}));
vi.mock("./AgentPlanChangeNotification", () => ({
  recordPlanChange: mocks.recordPlanChange,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
}));

const runFields: unknown = { id: "run", planId: "p1" };
const run = runFields as AgentPlanRun;

function transaction(rows: unknown[][]): {
  readonly query: ReturnType<typeof vi.fn<DatabaseTransaction["query"]>>;
  readonly execute: ReturnType<typeof vi.fn<DatabaseTransaction["execute"]>>;
} {
  return {
    query: vi.fn<DatabaseTransaction["query"]>(async () => rows as never),
    execute: vi.fn<DatabaseTransaction["execute"]>(async () => undefined),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readPlanSnapshot.mockReturnValue({ plan: { id: "p1" } });
  mocks.processedTicketEntries.mockReturnValue([{ ticket: "t" }]);
});

it("keeps the stacks when the stored basis is damaged", async () => {
  mocks.readPlanSnapshot.mockImplementation(() => {
    throw new Error("damaged");
  });
  const tx = transaction([]);

  await clearProcessedTicketEntries(tx, { run, snapshot: {} });

  expect(mocks.logCaughtError).toHaveBeenCalled();
  expect(tx.query).not.toHaveBeenCalled();
});

it("ignores a basis frozen for another plan", async () => {
  mocks.readPlanSnapshot.mockReturnValue({ plan: { id: "other" } });
  const tx = transaction([]);

  await clearProcessedTicketEntries(tx, { run, snapshot: {} });

  expect(tx.query).not.toHaveBeenCalled();
});

it("does nothing when the run processed no ticket", async () => {
  mocks.processedTicketEntries.mockReturnValue([]);
  const tx = transaction([]);

  await clearProcessedTicketEntries(tx, { run, snapshot: {} });

  expect(tx.query).not.toHaveBeenCalled();
});

it("does nothing when the plan is gone", async () => {
  const tx = transaction([]);

  await clearProcessedTicketEntries(tx, { run, snapshot: {} });

  expect(tx.execute).not.toHaveBeenCalled();
});

it("keeps the plan when no entry matches any more", async () => {
  mocks.withoutProcessedTicketEntries.mockReturnValue(null);
  const tx = transaction([["{}"]]);

  await clearProcessedTicketEntries(tx, { run, snapshot: {} });

  expect(tx.execute).not.toHaveBeenCalled();
});

it("stores the cleaned plan and announces the change", async () => {
  mocks.withoutProcessedTicketEntries.mockReturnValue("cleaned");
  const tx = transaction([["{}"]]);

  await clearProcessedTicketEntries(tx, { run, snapshot: {} });

  expect(tx.execute.mock.calls[0]?.[1]).toEqual({
    plan_id: "p1",
    plan_json: "cleaned",
  });
  expect(mocks.recordPlanChange).toHaveBeenCalledWith(tx);
});
