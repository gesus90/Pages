import { beforeEach, expect, it, vi, type Mock } from "vitest";

import { logCaughtError } from "@/backend/logging/Logger";

import { AgentPlanAgentTodoRepository } from "./AgentPlanAgentTodoRepository";
import { AgentSessionEventRepository } from "./AgentSessionEventRepository";
import { AgentSessionRepository } from "./AgentSessionRepository";
import { CodexPlanUsageRepository } from "./CodexPlanUsageRepository";
import { OpenCodeUsageRepository } from "./OpenCodeUsageRepository";
import { writeAgentSessionUsage } from "./AgentSessionUsageWriter";

import type { AgentSessionDatabase } from "./AgentSessionDatabase";
import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type {
  AgentSessionAttemptRecord,
  OpenRouterUsageRecord,
} from "@/backend/service/agents/sessions/AgentSessionStore";
import type { StoredOpenCodeUsage } from "@/backend/service/agents/sessions/OpenCodeUsage";
import type {
  AgentSessionEvent,
  AgentSessionMessage,
  AgentSessionTurnUsage,
} from "@/definition/AgentSessionJournal";

const mocks = vi.hoisted(() => ({
  appendEvents: vi.fn(),
  readEvents: vi.fn(),
  readWindow: vi.fn(),
  findEntries: vi.fn(),
  saveTodos: vi.fn(),
  saveCodex: vi.fn(),
  saveOpenCode: vi.fn(),
  listOpenCode: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));
vi.mock("./AgentSessionUsageWriter", () => ({
  writeAgentSessionUsage: vi.fn(async () => {}),
}));
vi.mock("./AgentSessionEventRepository", () => ({
  AgentSessionEventRepository: vi.fn(
    class {
      public appendEvents = mocks.appendEvents;
      public readEvents = mocks.readEvents;
      public readWindow = mocks.readWindow;
    },
  ),
}));
vi.mock("./AgentPlanAgentTodoRepository", () => ({
  AgentPlanAgentTodoRepository: vi.fn(
    class {
      public findEntries = mocks.findEntries;
      public save = mocks.saveTodos;
    },
  ),
}));
vi.mock("./CodexPlanUsageRepository", () => ({
  CodexPlanUsageRepository: vi.fn(
    class {
      public save = mocks.saveCodex;
    },
  ),
}));
vi.mock("./OpenCodeUsageRepository", () => ({
  OpenCodeUsageRepository: vi.fn(
    class {
      public save = mocks.saveOpenCode;
      public listRun = mocks.listOpenCode;
    },
  ),
}));

beforeEach(() => {
  vi.mocked(logCaughtError).mockClear();
  vi.mocked(writeAgentSessionUsage).mockClear();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.findEntries.mockResolvedValue([]);
});

function databaseOf(...results: DatabaseValue[][][]): {
  readonly database: AgentSessionDatabase;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(
    async () => results.shift() ?? [],
  );
  const transaction: AgentSessionDatabase["transaction"] = async (work) =>
    work({ execute, query });
  const database: AgentSessionDatabase = { execute, query, transaction };
  return { database, execute, query };
}

const ATTEMPT: AgentSessionAttemptRecord = {
  key: { attemptId: "a1", planId: "p1", runId: "r1", stepId: "s1" },
  userId: "u1",
  provider: "codex_cli",
  instanceId: "i1",
  groupId: null,
  state: "running",
  context: {
    contextUsed: null,
    contextLimit: null,
    percent: null,
    source: null,
    reportedAt: null,
  },
  confirmedModel: { value: null, source: null, reportedAt: null },
  confirmedReasoning: { value: null, source: null, reportedAt: null },
  workspace: null,
  updatedAt: "t",
};

async function savedParameters(
  attempt: AgentSessionAttemptRecord,
): Promise<Record<string, unknown>> {
  const { database, execute } = databaseOf();
  await new AgentSessionRepository(database).saveAttempt(attempt);
  return { ...execute.mock.calls[0]?.[1] };
}

it("saves an attempt without optional values", async () => {
  expect(await savedParameters(ATTEMPT)).toMatchObject({
    attempt_id: "a1",
    connection_id: null,
    requested_model: null,
    agent_id: null,
    cost_amount: null,
    cost_currency: null,
    workspace_directory: null,
    git_state: null,
    git_reference: null,
    workspace_at: null,
  });
});

it("saves the cost, the owner and the Git references", async () => {
  const git = async (
    state: NonNullable<AgentSessionAttemptRecord["workspace"]>["git"],
  ): Promise<Record<string, unknown>> =>
    savedParameters({
      ...ATTEMPT,
      connectionId: "c1",
      agentId: "ag1",
      requestedModel: "m1",
      context: { ...ATTEMPT.context, cost: { amount: 2, currency: "USD" } },
      workspace: { directory: "/w", git: state, checkedAt: "t2" },
    });
  expect(await git({ state: "branch", branch: "main" })).toMatchObject({
    connection_id: "c1",
    agent_id: "ag1",
    requested_model: "m1",
    cost_amount: 2,
    cost_currency: "USD",
    workspace_directory: "/w",
    git_state: "branch",
    git_reference: "main",
    workspace_at: "t2",
  });
  expect(await git({ state: "detached", commit: "abc" })).toMatchObject({
    git_reference: "abc",
  });
  expect(await git({ state: "no_repository" })).toMatchObject({
    git_reference: null,
  });
});

it("finds an attempt", async () => {
  const row: DatabaseValue[] = [
    "a1",
    "p1",
    "r1",
    "s1",
    "u1",
    "opencode",
    "i1",
    null,
    "idle",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    "t",
    null,
    null,
    null,
    null,
    null,
  ];
  const { database, query } = databaseOf([row]);
  const repository = new AgentSessionRepository(database);
  await expect(repository.findAttempt("a1")).resolves.toMatchObject({
    key: { attemptId: "a1" },
    state: "idle",
  });
  expect(query.mock.calls[0]?.[1]).toEqual({ attempt_id: "a1" });
  await expect(repository.findAttempt("a2")).resolves.toBeNull();
});

it("delegates native OpenCode messages", async () => {
  const usage: StoredOpenCodeUsage = {
    id: "m1",
    sessionId: "n1",
    model: null,
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    costUsd: null,
    attemptId: "a1",
    turn: 1,
    price: { amount: null, state: "unknown", priceAsOf: null },
    reportedAt: "t",
  };
  mocks.listOpenCode.mockResolvedValue([usage]);
  const repository = new AgentSessionRepository(databaseOf().database);
  await repository.saveOpenCodeMessage(usage);
  await expect(repository.listRunOpenCodeMessages("r1")).resolves.toEqual([
    usage,
  ]);
  expect(mocks.saveOpenCode).toHaveBeenCalledWith(usage);
  expect(mocks.listOpenCode).toHaveBeenCalledWith("r1");
  expect(OpenCodeUsageRepository).toHaveBeenCalled();
});

it("delegates event reads to the event repository", async () => {
  const repository = new AgentSessionRepository(databaseOf().database);
  await repository.readEvents("a1", 1, 2);
  await repository.readWindow("a1", { after: 0, limit: 2 });
  expect(mocks.readEvents).toHaveBeenCalledWith("a1", 1, 2);
  expect(mocks.readWindow).toHaveBeenCalledWith("a1", { after: 0, limit: 2 });
  expect(AgentSessionEventRepository).toHaveBeenCalled();
  expect(AgentPlanAgentTodoRepository).toHaveBeenCalled();
});

const USAGE: AgentSessionTurnUsage = {
  attemptId: "a1",
  turn: 1,
  provider: "codex_cli",
  model: null,
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  totalTokens: null,
  inputIncludesCache: null,
  isPartial: false,
  reportedAt: "t",
};

it("stores Codex native usage in its own ledger", async () => {
  const { database } = databaseOf();
  const usage: AgentSessionTurnUsage = {
    ...USAGE,
    codex: { connectionId: "c1", agentId: "ag1", report: null },
  };
  await new AgentSessionRepository(database).saveTurnUsage(usage);
  expect(CodexPlanUsageRepository).toHaveBeenCalledWith(database);
  expect(mocks.saveCodex).toHaveBeenCalledWith(usage);
  expect(writeAgentSessionUsage).not.toHaveBeenCalled();
});

it("writes the other turn usage directly", async () => {
  const { database } = databaseOf();
  const repository = new AgentSessionRepository(database);
  await repository.saveTurnUsage(USAGE);
  await repository.saveTurnUsage({
    ...USAGE,
    provider: "claude_code",
    codex: { connectionId: "c1", agentId: "ag1", report: null },
  });
  expect(writeAgentSessionUsage).toHaveBeenCalledTimes(2);
  expect(mocks.saveCodex).not.toHaveBeenCalled();
});

function usageRow(): DatabaseValue[] {
  return [
    "a1",
    2,
    "opencode",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    0,
    "t",
    null,
    null,
    null,
  ];
}

it("reads the usage of an attempt and of one turn", async () => {
  const { database, query } = databaseOf([usageRow()], [usageRow()], []);
  const repository = new AgentSessionRepository(database);
  const listed = await repository.listAttemptUsage("a1");
  expect(listed).toHaveLength(1);
  expect((await repository.findTurnUsage("a1", 2))?.turn).toBe(2);
  expect(query.mock.calls[1]?.[1]).toEqual({ attempt_id: "a1", turn: 2 });
  await expect(repository.findTurnUsage("a1", 3)).resolves.toBeNull();
});

const OPENROUTER: OpenRouterUsageRecord = {
  sessionId: "n1",
  messageId: "m1",
  attemptId: "a1",
  model: "mod",
  inputTokens: 1,
  outputTokens: 2,
  reasoningTokens: 3,
  cacheReadTokens: 4,
  cacheWriteTokens: 5,
  nativeCost: null,
  costAmount: 0.5,
  costState: "known",
  priceSnapshot: null,
  pricedAt: null,
  reportedAt: "t",
};

it("stores a native OpenRouter message once", async () => {
  const { database, query } = databaseOf([["m1"]], []);
  const repository = new AgentSessionRepository(database);
  await expect(repository.saveOpenRouterUsage(OPENROUTER)).resolves.toBe(true);
  await expect(repository.saveOpenRouterUsage(OPENROUTER)).resolves.toBe(false);
  expect(query.mock.calls[0]?.[1]).toMatchObject({
    native_session_id: "n1",
    message_id: "m1",
    cost_amount: 0.5,
    cost_state: "known",
  });
});

it("lists the turns of a run with native OpenRouter messages", async () => {
  const native: DatabaseValue[] = [
    "a1",
    1,
    "m",
    1,
    2,
    3,
    4,
    5,
    "t",
    null,
    null,
    "unknown",
    null,
    null,
  ];
  const { database, query } = databaseOf([usageRow()], [native]);
  const usage = await new AgentSessionRepository(database).listRunUsage("r1");
  expect(usage.map((turn) => turn.turn)).toEqual([2, 1]);
  expect(query.mock.calls[1]?.[1]).toEqual({ run_id: "r1" });
});

const MESSAGE: AgentSessionMessage = {
  id: "m1",
  attemptId: "a1",
  userId: "u1",
  kind: "instruction",
  text: "do it",
  status: "queued",
  createdAt: "t1",
  updatedAt: "t2",
};

it("saves and lists messages", async () => {
  const row: DatabaseValue[] = [
    "m1",
    "a1",
    "u1",
    "instruction",
    "do it",
    "queued",
    "t1",
    "t2",
  ];
  const { database, execute } = databaseOf([row]);
  const repository = new AgentSessionRepository(database);
  await repository.saveMessage(MESSAGE);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "m1",
    attempt_id: "a1",
    user_id: "u1",
    kind: "instruction",
    body: "do it",
    status: "queued",
    created_at: "t1",
    updated_at: "t2",
  });
  await expect(repository.listMessages("a1")).resolves.toEqual([MESSAGE]);
});

it("changes a message status only from the expected statuses", async () => {
  const { database, query } = databaseOf([["m1"]], []);
  const repository = new AgentSessionRepository(database);
  await expect(
    repository.updateMessage("m1", ["queued", "failed"], "delivering"),
  ).resolves.toBe(true);
  expect(query.mock.calls[0]?.[1]).toMatchObject({
    id: "m1",
    status: "delivering",
    from_0: "queued",
    from_1: "failed",
  });
  expect(query.mock.calls[0]?.[0]).toContain("IN ($from_0, $from_1)");
  await expect(
    repository.updateMessage("m1", ["queued"], "failed"),
  ).resolves.toBe(false);
  await expect(repository.updateMessage("m1", [], "failed")).resolves.toBe(
    false,
  );
  expect(query).toHaveBeenCalledTimes(2);
});

it("marks interrupted deliveries as uncertain", async () => {
  const { database } = databaseOf([["m1"], ["m2"]]);
  await expect(
    new AgentSessionRepository(database).markUncertainDeliveries(),
  ).resolves.toBe(2);
});

function planEvent(
  text: string,
  overrides: Partial<AgentSessionEvent> = {},
): AgentSessionEvent {
  return {
    id: "a1:1",
    sequence: 1,
    stepId: "s1",
    attemptId: "a1",
    turn: null,
    kind: "plan",
    createdAt: "t-plan",
    text,
    isTruncated: false,
    ...overrides,
  };
}

const PLAN = JSON.stringify({
  entries: [{ content: " Write ", status: "in_progress" }],
});

async function append(
  events: readonly AgentSessionEvent[],
  ...rows: DatabaseValue[][][]
): Promise<Mock<DatabaseTransaction["query"]>> {
  mocks.appendEvents.mockResolvedValue(events);
  const { database, query } = databaseOf(...rows);
  const stored = await new AgentSessionRepository(database).appendEvents(
    "a1",
    [],
    10,
  );
  expect(stored).toBe(events);
  return query;
}

it("keeps the todos of the newest plan event", async () => {
  mocks.findEntries.mockResolvedValue([]);
  await append([planEvent("ignored"), planEvent(PLAN)]);
  expect(mocks.saveTodos).toHaveBeenCalledWith(
    "a1",
    [{ id: "1", text: "Write", status: "active", updatedAt: "t-plan" }],
    "t-plan",
  );
});

it("ignores events without a plan", async () => {
  const query = await append([planEvent("x", { kind: "status" })]);
  expect(query).not.toHaveBeenCalled();
  expect(mocks.saveTodos).not.toHaveBeenCalled();
});

it("treats an unreadable Codex plan as an empty list", async () => {
  await append([planEvent("cut", { isTruncated: true })], [["codex_cli"]]);
  expect(mocks.saveTodos).toHaveBeenCalledWith("a1", [], "t-plan");
  await append([planEvent("not json")], [["codex_cli"]]);
  expect(mocks.saveTodos).toHaveBeenCalledTimes(2);
});

it("falls back to the newest complete plan of another provider", async () => {
  const complete = planEvent(PLAN, { sequence: 1 });
  const cut = planEvent("cut", { sequence: 2, isTruncated: true });
  await append([complete, cut], [["claude_code"]]);
  expect(mocks.saveTodos).toHaveBeenCalledWith(
    "a1",
    [expect.objectContaining({ text: "Write" })],
    "t-plan",
  );
  mocks.saveTodos.mockClear();
  await append([complete, cut]);
  expect(mocks.saveTodos).toHaveBeenCalledOnce();
});

it("keeps no todos without a readable plan", async () => {
  await append([planEvent("cut", { isTruncated: true })], [["claude_code"]]);
  await append([planEvent("not json")], [["claude_code"]]);
  await append(
    [
      planEvent("[1]", { sequence: 1 }),
      planEvent("cut", { isTruncated: true }),
    ],
    [["claude_code"]],
  );
  expect(mocks.saveTodos).not.toHaveBeenCalled();
  expect(logCaughtError).not.toHaveBeenCalled();
});

it("logs a failed todo update without failing the append", async () => {
  const failure = new Error("write failed");
  mocks.saveTodos.mockRejectedValue(failure);
  await append([planEvent(PLAN)]);
  expect(logCaughtError).toHaveBeenCalledWith(
    "AgentSessionRepository",
    failure,
  );
});
