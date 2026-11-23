import { beforeEach, expect, it, vi } from "vitest";

import {
  AgentPlanRunVisibilityRepository,
  planRunResourcesOf,
  readRunStatus,
} from "./AgentPlanRunVisibilityRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

const mocks = vi.hoisted(() => ({
  readPlanRunResources: vi.fn(),
  readStoredTicketAsset: vi.fn((asset: unknown) => asset),
  readStoredAgentPayload: vi.fn(
    async (database: unknown, text: string) => text,
  ),
  logCaughtError: vi.fn(),
}));

vi.mock("@/backend/agents/AgentPlanRunResources", () => ({
  readPlanRunResources: mocks.readPlanRunResources,
  readStoredTicketAsset: mocks.readStoredTicketAsset,
}));
vi.mock("@/backend/storage/AgentPayloadFileStore", () => ({
  readStoredAgentPayload: mocks.readStoredAgentPayload,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
}));

type DatabaseSlice = Pick<Database, "query" | "agentFiles">;

function resources(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    projectId: "proj",
    workspaceIds: ["w1"],
    agentIds: ["a1"],
    taskIds: ["t1"],
    wikiIds: ["k1"],
    ticketIds: ["i1"],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.readPlanRunResources.mockReset();
  mocks.readStoredTicketAsset.mockClear();
  mocks.logCaughtError.mockReset();
  mocks.readPlanRunResources.mockImplementation(
    (snapshot: unknown) => snapshot,
  );
});

it("reads every stored run status and refuses an unknown one", () => {
  for (const status of [
    "running",
    "pausing",
    "stopping",
    "succeeded",
    "failed",
    "cancelled",
    "paused",
    "work_done_closeout_open",
  ])
    expect(readRunStatus(status)).toBe(status);
  expect(() => readRunStatus("lost")).toThrowError(
    expect.objectContaining({ code: "plan_invalid" }),
  );
});

it("refuses a run without any execution basis", () => {
  expect(() => planRunResourcesOf([])).toThrowError(
    expect.objectContaining({ code: "plan_access_denied" }),
  );
});

it("combines minimal bases", () => {
  const combined = planRunResourcesOf([JSON.stringify(resources())]);

  expect(combined).toEqual({
    projectId: "proj",
    stepTickets: {},
    workspaceIds: ["w1"],
    agentIds: ["a1"],
    connectionIds: [],
    taskIds: ["t1"],
    wikiIds: ["k1"],
    ticketIds: ["i1"],
    ticketAssets: [],
  });
});

it("combines remote bases newest first and merges their references", () => {
  const newest = resources({
    executionTarget: { kind: "remote" },
    remoteWorkspaceIds: ["r1", "r2"],
    stepTickets: { s: "new", n: "n" },
    connectionIds: ["c1"],
    ticketAssets: [{ id: "x" }],
  });
  const oldest = resources({
    workspaceIds: ["w1", "w2"],
    remoteWorkspaceIds: ["r2"],
    stepTickets: { s: "old" },
    executionTarget: { kind: "local" },
  });

  const combined = planRunResourcesOf([
    JSON.stringify(newest),
    JSON.stringify(oldest),
  ]);

  expect(combined.executionTarget).toEqual({ kind: "remote" });
  expect(combined.remoteWorkspaceIds).toEqual(["r1", "r2"]);
  expect(combined.stepTickets).toEqual({ s: "new", n: "n" });
  expect(combined.workspaceIds).toEqual(["w1", "w2"]);
  expect(combined.connectionIds).toEqual(["c1"]);
  expect(combined.ticketAssets).toEqual([{ id: "x" }]);
});

it("ignores a local execution target", () => {
  const combined = planRunResourcesOf([
    JSON.stringify(resources({ executionTarget: { kind: "local" } })),
  ]);

  expect(combined.executionTarget).toBeUndefined();
});

function runRow(id: string, revision = 0, bases = 1): DatabaseValue[] {
  return [id, "2026-01-01", "running", revision, bases];
}

function repository(
  versions: unknown[][],
  views: unknown[][],
  snapshots: unknown[][],
): {
  readonly query: ReturnType<typeof vi.fn<Database["query"]>>;
  readonly repository: AgentPlanRunVisibilityRepository;
} {
  const query = vi
    .fn<Database["query"]>()
    .mockResolvedValueOnce(versions as never)
    .mockResolvedValueOnce(views as never)
    .mockResolvedValueOnce(snapshots as never);
  const database = { query } as unknown as DatabaseSlice;
  return { query, repository: new AgentPlanRunVisibilityRepository(database) };
}

it("lists the bases with their resources and remembers them", async () => {
  const { query, repository: repo } = repository(
    [runRow("r1")],
    [["r1", JSON.stringify([{ id: "asset" }])]],
    [["r1", JSON.stringify(resources())]],
  );

  const first = await repo.bases(null, "p1");
  query.mockResolvedValueOnce([runRow("r1")] as never);
  const second = await repo.bases("u1", "p1");

  expect(first[0]).toMatchObject({
    id: "r1",
    status: "running",
    used: { viewAssets: [{ id: "asset" }] },
  });
  expect(second).toEqual(first);
  expect(query).toHaveBeenCalledTimes(4);
});

it("reports a damaged record as null and logs it", async () => {
  const { repository: repo } = repository(
    [runRow("r1")],
    [["r1", null]],
    [["r1", JSON.stringify(resources())]],
  );

  const bases = await repo.bases("u1", "p1");

  expect(bases[0]?.used).toBeNull();
  expect(mocks.logCaughtError).toHaveBeenCalled();
});

it("treats a view that is not a list as damaged", async () => {
  const { repository: repo } = repository(
    [runRow("r1")],
    [["r1", JSON.stringify({})]],
    [["r1", JSON.stringify(resources())]],
  );

  expect((await repo.bases("u1", "p1"))[0]?.used).toBeNull();
});

it("treats a run without snapshots as damaged and skips unlisted views", async () => {
  const { repository: repo } = repository(
    [runRow("r1")],
    [
      ["ghost", "[]"],
      ["r1", "[]"],
    ],
    [],
  );

  expect((await repo.bases("u1", "p1"))[0]?.used).toBeNull();
});

it("keeps reading unremembered runs as null", async () => {
  const { repository: repo } = repository([runRow("r1")], [], []);

  expect((await repo.bases("u1", "p1"))[0]?.used).toBeNull();
});

it("reads runs in chunks and joins the snapshots of one run", async () => {
  const ids = Array.from({ length: 101 }, (_, index) => `r${String(index)}`);
  const query = vi
    .fn<Database["query"]>()
    .mockResolvedValueOnce(ids.map((id) => runRow(id)))
    .mockResolvedValueOnce([] as never)
    .mockResolvedValueOnce([
      ["r0", JSON.stringify(resources())],
      ["r0", JSON.stringify(resources())],
    ] as never)
    .mockResolvedValueOnce([] as never)
    .mockResolvedValueOnce([] as never);
  const repo = new AgentPlanRunVisibilityRepository({
    query,
  });

  await repo.bases("u1", "p1");

  expect(query).toHaveBeenCalledTimes(5);
});

it("forgets the remembered runs once the memory limit is reached", async () => {
  const total = 20_001;
  const rows = Array.from({ length: total }, (_, index) =>
    runRow(`r${String(index)}`),
  );
  const query = vi.fn<Database["query"]>(
    async (sql: string, parameters?: Record<string, unknown>) => {
      if (sql.includes("recovery_revision")) return rows;
      const wanted = new Set(Object.values(parameters ?? {}));
      const chunk = rows.filter(([id]) => wanted.has(id));
      if (sql.includes("view_assets")) return chunk.map(([id]) => [id, "[]"]);
      return chunk.map(([id]) => [id, JSON.stringify(resources())]);
    },
  );
  const repo = new AgentPlanRunVisibilityRepository({
    query,
  });

  const bases = await repo.bases(null, "p1");

  expect(bases).toHaveLength(total);
}, 60_000);
