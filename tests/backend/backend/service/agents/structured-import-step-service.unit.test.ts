import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";
import {
  manifestOf,
  milestoneSource,
  projectSource,
  ticketSource,
} from "../agents-import/structured-manifest-fixture";

import type { StructuredStepDependencies } from "@/backend/service/agents/StructuredImportStepService";
import type { AgentIdentity } from "@/definition/McpAuthorization";

const boundary = vi.hoisted(() => ({
  environment: vi.fn(),
  findStoredItem: vi.fn(),
  record: vi.fn(),
  findSource: vi.fn(),
  insert: vi.fn(),
}));
vi.mock("@/backend/service/agents/StructuredImportEnvironment", () => ({
  createStructuredImportEnvironment: boundary.environment,
}));
vi.mock("@/backend/database/repositories/agents/AgentImportRepository", () => ({
  AgentImportRepository: class {
    public findStoredItem = boundary.findStoredItem;
    public recordStructuredItem = boundary.record;
  },
}));

import { planStructuredImport } from "@/backend/service/agents/StructuredImportPlanner";
import { StructuredImportStepService } from "@/backend/service/agents/StructuredImportStepService";

const transaction = { execute: vi.fn(), query: vi.fn() };
const verify = vi.fn(async () => partial<AgentIdentity>({ userId: "user" }));
const createTicket = vi.fn();
const createMilestone = vi.fn();
const announce = vi.fn();
const graph = planStructuredImport(
  manifestOf([
    projectSource(),
    ticketSource("ticket"),
    milestoneSource("milestone"),
  ]),
);
const run = {
  id: "run",
  userId: "user",
  graph,
  projectIds: new Map([["main", "project-1"]]),
};
const service = new StructuredImportStepService(
  partial<StructuredStepDependencies>({
    database: {
      transaction: async (
        work: (value: typeof transaction) => Promise<unknown>,
      ) => work(transaction),
    },
    tickets: { createWithin: createTicket },
    milestones: { createWithin: createMilestone },
    announcer: { announce },
  }),
);

beforeEach(() => {
  vi.resetAllMocks();
  boundary.findStoredItem.mockResolvedValue(null);
  boundary.findSource.mockResolvedValue(null);
  boundary.environment.mockResolvedValue({
    imports: {
      findStoredItem: boundary.findStoredItem,
      findSource: boundary.findSource,
      insertSource: boundary.insert,
      recordStructuredItem: boundary.record,
    },
  });
  verify.mockResolvedValue(partial<AgentIdentity>({ userId: "user" }));
  createTicket.mockResolvedValue({
    result: { ticketId: "ticket-id", key: "KEY-1", link: "/ticket/1" },
  });
  createMilestone.mockResolvedValue({
    result: { milestoneId: "milestone-id" },
  });
});

it("creates a milestone and ticket transactionally, recording the result before announcing", async () => {
  const milestone = graph.steps.find((step) => step.kind === "milestone");
  const ticket = graph.steps.find((step) => step.kind === "ticket");
  if (!milestone || !ticket) throw new Error("Expected planned steps");
  await service.apply(run, milestone, 0, verify);
  await service.apply(run, ticket, 1, verify);
  expect(createMilestone).toHaveBeenCalledOnce();
  expect(createTicket).toHaveBeenCalledOnce();
  expect(boundary.insert).toHaveBeenCalledTimes(2);
  expect(boundary.record).toHaveBeenCalledWith(
    "run",
    1,
    expect.objectContaining({
      action: "created",
      targetId: "ticket-id",
      key: "KEY-1",
    }),
  );
  expect(announce).toHaveBeenCalledTimes(2);
  expect(boundary.record.mock.invocationCallOrder[1]).toBeLessThan(
    announce.mock.invocationCallOrder[1],
  );
});

it("does not repeat a step already recorded by the run", async () => {
  boundary.findStoredItem.mockResolvedValue({ action: "created" });
  await service.apply(run, graph.steps[0], 0, verify);
  expect(createMilestone).not.toHaveBeenCalled();
  expect(boundary.record).not.toHaveBeenCalled();
  expect(announce).not.toHaveBeenCalled();
});

it("records a blocked dependent ticket instead of creating it", async () => {
  const dependent = planStructuredImport(
    manifestOf(
      [projectSource(), ticketSource("parent"), ticketSource("child")],
      { links: [{ type: "parent", from: "child", to: "parent" }] },
    ),
  );
  const child = dependent.steps.find((step) => step.name === "child");
  if (!child) throw new Error("Expected child");
  await service.apply({ ...run, graph: dependent }, child, 1, verify);
  expect(createTicket).not.toHaveBeenCalled();
  expect(boundary.record).toHaveBeenCalledWith(
    "run",
    1,
    expect.objectContaining({
      action: "conflict",
      reason: "blocked",
      errorCode: "CONFLICT",
    }),
  );
});
