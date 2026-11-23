import { beforeEach, expect, it, vi, type Mock } from "vitest";

import {
  AgentConnectionRepository,
  type AgentConnectionChange,
  type AgentConnectionWrite,
} from "./AgentConnectionRepository";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

const siblings = vi.hoisted(() => ({
  checkClear: vi.fn<(id: string) => Promise<void>>(async () => {}),
  checkClearModel: vi.fn<(id: string) => Promise<void>>(async () => {}),
  catalogInvalidate: vi.fn<(id: string) => Promise<void>>(async () => {}),
  catalogRemove: vi.fn<(id: string) => Promise<void>>(async () => {}),
  quotaRemove: vi.fn<(id: string) => Promise<void>>(async () => {}),
  scopeSave: vi.fn<(id: string, scope: unknown) => Promise<void>>(
    async () => {},
  ),
  scopeRemove: vi.fn<(id: string) => Promise<void>>(async () => {}),
  created: [] as { readonly name: string; readonly database: unknown }[],
}));

vi.mock("./agent/AgentCheckRepository", () => ({
  AgentCheckRepository: class {
    public clear = siblings.checkClear;
    public clearModel = siblings.checkClearModel;
    public constructor(database: unknown) {
      siblings.created.push({ name: "checks", database });
    }
  },
}));
vi.mock("./agent/AgentCatalogRepository", () => ({
  AgentCatalogRepository: class {
    public invalidate = siblings.catalogInvalidate;
    public remove = siblings.catalogRemove;
    public constructor(database: unknown) {
      siblings.created.push({ name: "catalogs", database });
    }
  },
}));
vi.mock("./agent/AgentConnectionScopeRepository", () => ({
  AgentConnectionScopeRepository: class {
    public save = siblings.scopeSave;
    public remove = siblings.scopeRemove;
    public constructor(database: unknown) {
      siblings.created.push({ name: "scopes", database });
    }
  },
}));
vi.mock("./agent/ClaudeQuotaRepository", () => ({
  ClaudeQuotaRepository: class {
    public remove = siblings.quotaRemove;
    public constructor(database: unknown) {
      siblings.created.push({ name: "quotas", database });
    }
  },
}));
vi.mock("./agent/AgentProfileRepository", () => ({
  AgentProfileRepository: class {
    public constructor(database: unknown) {
      siblings.created.push({ name: "profiles", database });
    }
  },
}));
vi.mock("./agent/AntigravityQuotaRepository", () => ({
  AntigravityQuotaRepository: class {
    public constructor(database: unknown) {
      siblings.created.push({ name: "antigravity", database });
    }
  },
}));
vi.mock("./agent/CodexQuotaRepository", () => ({
  CodexQuotaRepository: class {
    public constructor(database: unknown) {
      siblings.created.push({ name: "codex", database });
    }
  },
}));

/** A transaction double that also serves as the database. */
function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: Database;
  readonly transaction: DatabaseTransaction;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () => rows);
  const transaction: DatabaseTransaction = { execute, query };
  const database = Object.assign(Object.create(null) as Database, {
    execute,
    query,
    transaction: async <Result>(
      work: (inner: DatabaseTransaction) => Promise<Result>,
    ): Promise<Result> => work(transaction),
  });
  return { database, transaction, execute, query };
}

const WRITE: AgentConnectionWrite = {
  id: "c1",
  name: "Main",
  provider: "openrouter",
  secretEncrypted: "secret",
  testModel: null,
  actorId: "u1",
};

const CHANGE: AgentConnectionChange = {
  name: "Main",
  secretEncrypted: null,
  testModel: "m",
  reasoningEffort: null,
  clearModel: false,
  actorId: "u1",
};

const CONNECTION_ROW: DatabaseValue[] = [
  "c1",
  "Main",
  "openrouter",
  0,
  null,
  null,
  null,
  "2026-01-01",
  null,
  1,
  null,
  null,
  "{}",
];

beforeEach(() => {
  vi.clearAllMocks();
  siblings.created.length = 0;
});

it("hands out the sibling repositories on the same database", () => {
  const { database } = databaseOf();
  const repository = new AgentConnectionRepository(database);
  repository.catalogs();
  repository.profiles();
  repository.quotas();
  repository.antigravityQuotas();
  repository.codexQuotas();
  repository.scopes();
  expect(repository.checks()).toBe(repository.checks());
  expect(siblings.created.map((entry) => entry.name)).toEqual([
    "checks",
    "catalogs",
    "profiles",
    "quotas",
    "antigravity",
    "codex",
    "scopes",
  ]);
  expect(siblings.created.every((entry) => entry.database === database)).toBe(
    true,
  );
});

it("lists and finds connections without retired providers", async () => {
  const { database, query } = databaseOf([CONNECTION_ROW]);
  const repository = new AgentConnectionRepository(database);
  const listed = await repository.list();
  expect(listed.map((record) => record.id)).toEqual(["c1"]);
  expect((await repository.find("c1"))?.name).toBe("Main");
  expect(query.mock.calls[0]?.[0]).toContain("NOT IN ('zai')");
  expect(query.mock.calls[1]?.[1]).toEqual({ id: "c1" });
});

it("returns null for a connection that does not exist", async () => {
  const { database } = databaseOf();
  await expect(
    new AgentConnectionRepository(database).find("c1"),
  ).resolves.toBeNull();
});

it("counts connections", async () => {
  const { database } = databaseOf([[4n]]);
  await expect(new AgentConnectionRepository(database).count()).resolves.toBe(
    4,
  );
});

it("names the agents that use a connection", async () => {
  const { database, query } = databaseOf([["a1", "Agent"]]);
  await expect(
    new AgentConnectionRepository(database).usages("c1"),
  ).resolves.toEqual([{ kind: "agent", id: "a1", name: "Agent" }]);
  expect(query.mock.calls[0]?.[1]).toEqual({ id: "c1" });
});

it("sets the availability", async () => {
  const { database, execute } = databaseOf();
  await new AgentConnectionRepository(database).setActive("c1", false, "u1");
  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "c1",
    is_active: false,
    actor_id: "u1",
  });
});

it("reads the stored credential", async () => {
  const repository = new AgentConnectionRepository(
    databaseOf([["cipher"]]).database,
  );
  await expect(repository.findSecretEncrypted("c1")).resolves.toBe("cipher");
  const empty = new AgentConnectionRepository(databaseOf().database);
  await expect(empty.findSecretEncrypted("c1")).resolves.toBeNull();
});

it("reads the credit settings of an OpenRouter connection", async () => {
  const { database } = databaseOf([["cipher", 20, null]]);
  await expect(
    new AgentConnectionRepository(database).findOpenRouterCreditSettings("c1"),
  ).resolves.toEqual({
    secretEncrypted: "cipher",
    startAmount: 20,
    usageAtStart: null,
  });
});

it("returns null credit settings for another provider", async () => {
  const { database } = databaseOf();
  await expect(
    new AgentConnectionRepository(database).findOpenRouterCreditSettings("c1"),
  ).resolves.toBeNull();
});

it("saves the credit display against its credential", async () => {
  const { database, query } = databaseOf([["c1"]]);
  await expect(
    new AgentConnectionRepository(database).saveOpenRouterCreditDisplay(
      "c1",
      { secretEncrypted: "cipher", startAmount: 5, usageAtStart: 2 },
      "u1",
    ),
  ).resolves.toBe(true);
  expect(query.mock.calls[0]?.[1]).toEqual({
    id: "c1",
    start_amount: 5,
    start_usage: 2,
    expected_secret: "cipher",
    actor_id: "u1",
  });
});

it("resets the credit display and reports a lost race", async () => {
  const { database, query } = databaseOf();
  await expect(
    new AgentConnectionRepository(database).saveOpenRouterCreditDisplay(
      "c1",
      null,
      "u1",
    ),
  ).resolves.toBe(false);
  expect(query.mock.calls[0]?.[1]).toEqual({
    id: "c1",
    start_amount: null,
    start_usage: null,
    expected_secret: null,
    actor_id: "u1",
  });
});

it("inserts a connection with defaults and a global scope", async () => {
  const { database, execute, transaction } = databaseOf();
  await new AgentConnectionRepository(database).insert(WRITE);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "c1",
    name: "Main",
    provider: "openrouter",
    claude_price_models: "{}",
    codex_price_mappings: "{}",
    secret_encrypted: "secret",
    openrouter_management_secret: null,
    test_model: null,
    openrouter_model_ids: "{}",
    actor_id: "u1",
  });
  expect(siblings.scopeSave).toHaveBeenCalledWith("c1", {
    mode: "global",
    targets: [],
  });
  expect(siblings.created).toContainEqual({
    name: "scopes",
    database: transaction,
  });
});

it("inserts a connection with its own tables and scope", async () => {
  const { database, execute } = databaseOf();
  const scope = { mode: "restricted", targets: [] } as const;
  await new AgentConnectionRepository(database).insert({
    ...WRITE,
    claudePriceModels: { a: "anthropic/a" },
    codexPriceMappings: { b: "c" },
    openRouterManagementSecret: "management",
    openRouterModelIds: { d: "e" },
    scope,
  });
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    claude_price_models: '{"a":"anthropic/a"}',
    codex_price_mappings: '{"b":"c"}',
    openrouter_management_secret: "management",
    openrouter_model_ids: '{"d":"e"}',
  });
  expect(siblings.scopeSave).toHaveBeenCalledWith("c1", scope);
});

it("updates metadata and keeps everything that is not given", async () => {
  const { database, execute } = databaseOf();
  await new AgentConnectionRepository(database).update("c1", CHANGE);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "c1",
    name: "Main",
    claude_price_models: null,
    codex_price_mappings: null,
    secret_encrypted: null,
    change_openrouter_management_secret: false,
    openrouter_management_secret: null,
    test_model: "m",
    reasoning_effort: null,
    openrouter_model_ids: null,
    actor_id: "u1",
  });
  expect(siblings.scopeSave).not.toHaveBeenCalled();
  expect(siblings.checkClear).not.toHaveBeenCalled();
  expect(siblings.checkClearModel).not.toHaveBeenCalled();
});

it("updates every optional field and the scope", async () => {
  const { database, execute } = databaseOf();
  const scope = { mode: "global", targets: [] } as const;
  await new AgentConnectionRepository(database).update("c1", {
    ...CHANGE,
    claudePriceModels: { a: "anthropic/a" },
    codexPriceMappings: { b: "c" },
    openRouterManagementSecret: null,
    openRouterModelIds: { d: "e" },
    scope,
  });
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    claude_price_models: '{"a":"anthropic/a"}',
    codex_price_mappings: '{"b":"c"}',
    change_openrouter_management_secret: true,
    openrouter_management_secret: null,
    openrouter_model_ids: '{"d":"e"}',
  });
  expect(siblings.scopeSave).toHaveBeenCalledWith("c1", scope);
});

it("discards checks and catalog when the credential is replaced", async () => {
  const { database } = databaseOf();
  await new AgentConnectionRepository(database).update("c1", {
    ...CHANGE,
    secretEncrypted: "new",
    clearModel: true,
  });
  expect(siblings.checkClear).toHaveBeenCalledWith("c1");
  expect(siblings.catalogInvalidate).toHaveBeenCalledWith("c1");
  expect(siblings.checkClearModel).not.toHaveBeenCalled();
});

it("discards the model check when the model is cleared", async () => {
  const { database } = databaseOf();
  await new AgentConnectionRepository(database).update("c1", {
    ...CHANGE,
    clearModel: true,
  });
  expect(siblings.checkClearModel).toHaveBeenCalledWith("c1");
  expect(siblings.checkClear).not.toHaveBeenCalled();
});

it("assigns a default model only while none is stored", async () => {
  const stored = databaseOf([["c1"]]);
  await expect(
    new AgentConnectionRepository(stored.database).assignDefaultModel(
      "c1",
      "m",
    ),
  ).resolves.toBe(true);
  expect(stored.query.mock.calls[0]?.[1]).toEqual({ id: "c1", model: "m" });
  expect(siblings.checkClearModel).toHaveBeenCalledWith("c1");
  siblings.checkClearModel.mockClear();
  const kept = databaseOf();
  await expect(
    new AgentConnectionRepository(kept.database).assignDefaultModel("c1", "m"),
  ).resolves.toBe(false);
  expect(siblings.checkClearModel).not.toHaveBeenCalled();
});

it("stores the CLI account and discards the previous checks", async () => {
  const { database, execute } = databaseOf();
  await new AgentConnectionRepository(database).setCliAccount(
    "c1",
    { loggedInAt: "2026-01-01", label: "me" },
    "u1",
  );
  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "c1",
    logged_in_at: "2026-01-01",
    label: "me",
    actor_id: "u1",
  });
  expect(siblings.checkClear).toHaveBeenCalledWith("c1");
});

it("removes dependents before the connection", async () => {
  const { database, execute } = databaseOf();
  await new AgentConnectionRepository(database).remove("c1");
  expect(siblings.checkClear).toHaveBeenCalledWith("c1");
  expect(siblings.catalogRemove).toHaveBeenCalledWith("c1");
  expect(siblings.scopeRemove).toHaveBeenCalledWith("c1");
  expect(siblings.quotaRemove).toHaveBeenCalledWith("c1");
  expect(execute.mock.calls[0]?.[1]).toEqual({ id: "c1" });
});
