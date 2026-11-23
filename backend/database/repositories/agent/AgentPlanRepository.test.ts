import { beforeEach, expect, it, vi } from "vitest";

import {
  requirePlanRevision,
  AgentPlanRepository,
} from "./AgentPlanRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AgentPlan } from "@/definition/AgentPlan";
import type * as AgentPlanGroupModule from "@/definition/AgentPlanGroup";

const mocked = vi.hoisted(() => ({
  steps: [] as unknown[],
  references: vi.fn(async () => {}),
}));

vi.mock("@/definition/AgentPlanGroup", async (importOriginal) => ({
  ...(await importOriginal<typeof AgentPlanGroupModule>()),
  allPlanSteps: () => mocked.steps,
}));

vi.mock("./AgentWorkspaceReferencesRepository", () => ({
  AgentWorkspaceReferencesRepository: class {
    public requireReferences = mocked.references;
  },
}));

vi.mock("./AgentPlanStoredReferences", () => ({
  requirePlanConnections: vi.fn(async () => {}),
  requireRemotePlanModels: vi.fn(async () => {}),
}));

const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
const query = vi.fn<DatabaseTransaction["query"]>();

const GRAPH = {
  name: "Plan",
  workspaceId: "w1",
  usage: "private",
  globals: {},
  nodes: [],
  edges: [],
};

const PLAN: AgentPlan = {
  ...GRAPH,
  usage: "private",
  id: "p1",
  ownerId: "u1",
  projectId: "pr1",
  revision: 2,
  departmentId: "d1",
  teams: [
    {
      kind: "department",
      targetId: "d1",
      canRead: true,
      canEdit: true,
      canRun: true,
    },
  ],
  scheduledDeletionAt: "t",
};

function planRow(
  json: unknown = GRAPH,
  overrides: Partial<{
    revision: number;
    owner: string;
    department: string | null;
    deletion: string | null;
  }> = {},
): DatabaseValue[] {
  return [
    "p1",
    overrides.owner ?? "u1",
    "pr1",
    overrides.revision ?? 2,
    JSON.stringify(json),
    overrides.department === undefined ? "d1" : overrides.department,
    overrides.deletion === undefined ? null : overrides.deletion,
  ];
}

function repository(): AgentPlanRepository {
  return new AgentPlanRepository({
    query,
    transaction: async (work) => work({ execute, query }),
  });
}

function failingRepository(error: unknown): AgentPlanRepository {
  return new AgentPlanRepository({
    query,
    transaction: async () => {
      throw error;
    },
  });
}

function writes(): Record<string, unknown>[] {
  return execute.mock.calls.map((call) => call[1] ?? {});
}

beforeEach(() => {
  execute.mockClear();
  query.mockReset();
  mocked.steps = [];
  mocked.references.mockClear();
});

it("lists plans with their teams and the deadline of a one-time plan", async () => {
  query
    .mockResolvedValueOnce([
      planRow(GRAPH, { deletion: "t" }),
      planRow({ ...GRAPH }),
    ])
    .mockResolvedValueOnce([["p1", "group", "g1", 1, 1, 0]]);

  const plans = await repository().list();

  expect(plans[0]).toMatchObject({
    id: "p1",
    ownerId: "u1",
    scheduledDeletionAt: "t",
    teams: [{ kind: "group", targetId: "g1" }],
  });
  expect(plans[1]?.teams).toHaveLength(1);
});

it("lists plans without teams as empty", async () => {
  query
    .mockResolvedValueOnce([
      ["x", "u", "p", 1, JSON.stringify(GRAPH), null, null],
    ])
    .mockResolvedValueOnce([]);

  expect((await repository().list())[0]?.teams).toEqual([]);
});

it("lists the identity and sharing of plans without their graph", async () => {
  const sharing = JSON.stringify({ isGlobal: false, targets: [] });
  query
    .mockResolvedValueOnce([
      [
        "p1",
        "u1",
        "pr1",
        "w1",
        "d1",
        "Plan",
        "workspace",
        3,
        sharing,
        "true",
        "t",
      ],
      ["p2", "u1", "pr1", "w1", null, "Other", "private", 1n, null, null, null],
    ])
    .mockResolvedValueOnce([["p1", "user", "u9", 1, 0, 0]]);

  const listings = await repository().listings();

  expect(listings[0]).toMatchObject({
    id: "p1",
    usage: "workspace",
    revision: 3,
    oneShot: true,
    scheduledDeletionAt: "t",
    sharing: { isGlobal: false, operator: "or" },
    teams: [{ targetId: "u9" }],
  });
  expect(listings[1]).toEqual({
    id: "p2",
    ownerId: "u1",
    projectId: "pr1",
    workspaceId: "w1",
    departmentId: null,
    name: "Other",
    usage: "private",
    revision: 1,
    teams: [],
  });
});

it("refuses a listing with an unknown usage", async () => {
  query
    .mockResolvedValueOnce([
      ["p1", "u1", "pr1", "w1", null, "Plan", "public", 1, null, null, null],
    ])
    .mockResolvedValueOnce([]);

  await expect(repository().listings()).rejects.toMatchObject({
    code: "plan_invalid",
  });
});

it("finds a plan with its teams, or none", async () => {
  query
    .mockResolvedValueOnce([planRow()])
    .mockResolvedValueOnce([["p1", "group", "g1", 1, 1, 1]])
    .mockResolvedValueOnce([]);

  expect(await repository().find("p1")).toMatchObject({
    name: "Plan",
    revision: 2,
    departmentId: "d1",
    teams: [{ targetId: "g1" }],
  });
  expect(await repository().find("p2")).toBeNull();
});

it("reads the stored source for a clone", async () => {
  query
    .mockResolvedValueOnce([[JSON.stringify(GRAPH)]])
    .mockResolvedValueOnce([]);

  expect(await repository().cloneSource("p1")).toEqual(GRAPH);
  await expect(repository().cloneSource("p2")).rejects.toMatchObject({
    code: "source_not_visible",
  });
});

it("requires a current and cloneable source", async () => {
  query
    .mockResolvedValueOnce([[2, JSON.stringify(GRAPH)]])
    .mockResolvedValueOnce([[3, JSON.stringify(GRAPH)]])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([[2, JSON.stringify({ ...GRAPH, unknown: 1 })]]);

  await expect(
    repository().requireCloneSource("p1", 2),
  ).resolves.toBeUndefined();
  await expect(repository().requireCloneSource("p1", 2)).rejects.toMatchObject({
    code: "plan_conflict",
  });
  await expect(repository().requireCloneSource("p1", 2)).rejects.toMatchObject({
    code: "plan_conflict",
  });
  await expect(repository().requireCloneSource("p1", 2)).rejects.toThrow();
});

it("stores a new plan with its teams, journal and notification", async () => {
  query.mockResolvedValueOnce([]).mockResolvedValueOnce([["pr1"]]);
  const journal = vi.fn(async () => {});

  await repository().save({ ...PLAN, revision: 1 }, true, journal, "editor");

  const stored = writes().find((write) => write.plan_json !== undefined);
  expect(stored).toMatchObject({
    id: "p1",
    name_key: "plan",
    updated_by: "editor",
    department_id: "d1",
  });
  expect(String(stored?.plan_json)).not.toContain("scheduledDeletionAt");
  expect(String(stored?.plan_json)).not.toContain("teams");
  expect(writes().some((write) => write.target_id === "d1")).toBe(true);
  expect(journal).toHaveBeenCalledTimes(1);
  expect(mocked.references).toHaveBeenCalledTimes(1);
  expect(writes().at(-1)).toMatchObject({ channel: "pages_live_changes" });
});

it("stores a new plan without teams, department or editor", async () => {
  query.mockResolvedValueOnce([]).mockResolvedValueOnce([["pr1"]]);
  const bare: AgentPlan = {
    ...GRAPH,
    usage: "private",
    id: "p1",
    ownerId: "u1",
    projectId: "pr1",
    revision: 1,
  };

  await repository().save(bare, true);

  const stored = writes().find((write) => write.plan_json !== undefined);
  expect(stored).toMatchObject({ department_id: null, updated_by: null });
});

it("stores a changed plan at its revision and accepts the remote target", async () => {
  query
    .mockResolvedValueOnce([planRow()])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([["pr1"]]);

  await repository().save(
    {
      ...PLAN,
      executionTarget: {
        kind: "remote",
        workspaceId: "rw",
      },
    },
    false,
  );

  expect(query.mock.calls[3]?.[1]).toMatchObject({ id: "w1", remote_id: "rw" });
  expect(writes().some((write) => write.target_id === "d1")).toBe(false);
});

it("stores a changed plan that has no department like the stored one", async () => {
  query
    .mockResolvedValueOnce([planRow(GRAPH, { department: null })])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([["pr1"]]);

  await repository().save({ ...PLAN, departmentId: undefined }, false);

  expect(writes().some((write) => write.department_id === null)).toBe(true);
});

it("refuses writes that do not fit the stored plan", async () => {
  query
    .mockResolvedValueOnce([planRow()])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([planRow(GRAPH, { revision: 5 })])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([planRow(GRAPH, { owner: "other" })])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([planRow(GRAPH, { department: null })])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);

  await expect(repository().save(PLAN, true)).rejects.toMatchObject({
    code: "plan_conflict",
  });
  await expect(repository().save(PLAN, false)).rejects.toMatchObject({
    code: "plan_conflict",
  });
  await expect(repository().save(PLAN, false)).rejects.toMatchObject({
    code: "plan_conflict",
  });
  await expect(repository().save(PLAN, false)).rejects.toMatchObject({
    code: "plan_conflict",
  });
  await expect(repository().save(PLAN, false)).rejects.toMatchObject({
    code: "plan_conflict",
  });
});

it("refuses to change a plan while a run executes steps", async () => {
  query
    .mockResolvedValueOnce([planRow()])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([["run"]]);

  await expect(repository().save(PLAN, false)).rejects.toMatchObject({
    code: "plan_pause_required",
  });
});

it("refuses a workspace outside the project or missing", async () => {
  query
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([["other"]])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);

  await expect(repository().save(PLAN, true)).rejects.toMatchObject({
    code: "plan_context_changed",
  });
  await expect(repository().save(PLAN, true)).rejects.toMatchObject({
    code: "plan_context_changed",
  });
});

it("checks the agent profiles that steps name and skips routed or empty ones", async () => {
  mocked.steps = [
    { agentId: "a1", personalAgentId: null },
    { agentId: "", personalAgentId: "a2" },
    {
      agentId: "a3",
      personalAgentId: null,
      configuration: { connectionId: "c" },
    },
    {
      agentId: "a4",
      personalAgentId: null,
      configuration: { runnerRoute: {} },
    },
  ];
  query
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([["pr1"]])
    .mockResolvedValueOnce([["a1"]])
    .mockResolvedValueOnce([["a2"]]);

  await repository().save(PLAN, true);

  expect(query.mock.calls.slice(2).map((call) => call[1])).toEqual([
    { id: "a1" },
    { id: "a2" },
  ]);
});

it("refuses a step whose agent profile is gone", async () => {
  mocked.steps = [{ agentId: "a1", personalAgentId: null }];
  query
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([["pr1"]])
    .mockResolvedValueOnce([]);

  await expect(repository().save(PLAN, true)).rejects.toMatchObject({
    code: "plan_context_changed",
  });
});

it("reports a name collision and passes other failures through", async () => {
  const duplicate = Object.assign(new Error("dup"), {
    code: "23505",
    detail: "Key (project_id, department_id, name_key)=(a, b, c) exists.",
  });
  const other = new Error("disk");

  await expect(
    failingRepository(duplicate).save(PLAN, true),
  ).rejects.toMatchObject({
    code: "plan_name_taken",
  });
  await expect(
    failingRepository(new Error("UNIQUE constraint violation")).save(
      PLAN,
      true,
    ),
  ).rejects.toMatchObject({ code: "plan_name_taken" });
  await expect(failingRepository(other).save(PLAN, true)).rejects.toBe(other);
  await expect(failingRepository("text").save(PLAN, true)).rejects.toBe("text");
});

it("lists the marked legacy plans", async () => {
  query.mockResolvedValueOnce([
    ["p1", "u1"],
    ["p2", "u2"],
  ]);

  expect(await repository().listLegacyShareCandidates()).toEqual([
    { id: "p1", ownerId: "u1" },
    { id: "p2", ownerId: "u2" },
  ]);
});

it("shares a legacy plan with the department of its owner", async () => {
  query.mockResolvedValueOnce([["Plan"]]);

  expect(await repository().shareLegacyPlan("p1", "d1")).toBe("shared");
  expect(writes()[0]).toEqual({
    id: "p1",
    department_id: "d1",
    name_key: "plan",
  });
  expect(writes().some((write) => write.kind === "department")).toBe(true);
});

it("settles a legacy plan that is gone or unmarked", async () => {
  query.mockResolvedValueOnce([]);

  expect(await repository().shareLegacyPlan("p1", "d1")).toBe("settled");
  expect(execute).not.toHaveBeenCalled();
});

it("keeps a colliding legacy plan private and drops its mark", async () => {
  const collision = new Error("UNIQUE constraint violation");
  let calls = 0;
  const database = new AgentPlanRepository({
    query,
    transaction: async (work) => {
      calls += 1;
      if (calls === 1) throw collision;
      return work({ execute, query });
    },
  });

  expect(await database.shareLegacyPlan("p1", "d1")).toBe("collision");
  expect(writes()).toEqual([{ id: "p1" }]);
});

it("rethrows another failure while sharing a legacy plan", async () => {
  const failure = new Error("disk");

  await expect(
    failingRepository(failure).shareLegacyPlan("p1", "d1"),
  ).rejects.toBe(failure);
});

it("removes the one-time mark as a new revision", async () => {
  query
    .mockResolvedValueOnce([[2, JSON.stringify({ ...GRAPH, oneShot: true })]])
    .mockResolvedValueOnce([]);
  const journal = vi.fn(async () => {});

  expect(
    await repository().keepOneShot("p1", {
      revision: 2,
      editorId: "u",
      journal,
    }),
  ).toBe(true);

  expect(JSON.parse(String(writes()[0]?.plan_json))).toEqual(GRAPH);
  expect(journal).toHaveBeenCalledTimes(1);
});

it("only cancels the deadline of a plan without the mark", async () => {
  query
    .mockResolvedValueOnce([[2, JSON.stringify(GRAPH)]])
    .mockResolvedValueOnce([[2, "[]"]])
    .mockResolvedValueOnce([[2, "null"]]);
  const journal = vi.fn(async () => {});

  expect(
    await repository().keepOneShot("p1", {
      revision: 2,
      editorId: "u",
      journal,
    }),
  ).toBe(false);
  expect(
    await repository().keepOneShot("p1", { revision: 2, editorId: "u" }),
  ).toBe(false);
  expect(
    await repository().keepOneShot("p1", { revision: 2, editorId: "u" }),
  ).toBe(false);
  expect(journal).toHaveBeenCalledTimes(1);
});

it("refuses to keep a plan at a stale revision, missing, or while it runs", async () => {
  query
    .mockResolvedValueOnce([[3, "{}"]])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([[2, JSON.stringify({ ...GRAPH, oneShot: true })]])
    .mockResolvedValueOnce([["run"]]);

  await expect(
    repository().keepOneShot("p1", { revision: 2, editorId: "u" }),
  ).rejects.toMatchObject({ code: "plan_conflict" });
  await expect(
    repository().keepOneShot("p1", { revision: 2, editorId: "u" }),
  ).rejects.toMatchObject({ code: "plan_conflict" });
  await expect(
    repository().keepOneShot("p1", { revision: 2, editorId: "u" }),
  ).rejects.toMatchObject({ code: "plan_pause_required" });
});

it("deletes a plan of its owner with the journal", async () => {
  query
    .mockResolvedValueOnce([planRow()])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);
  const journal = vi.fn(async () => {});

  await repository().remove("p1", "u1", { revision: 2, journal });

  expect(writes()[0]).toEqual({ id: "p1" });
  expect(journal).toHaveBeenCalledTimes(1);
});

it("lets an administrator delete without a revision", async () => {
  query
    .mockResolvedValueOnce([planRow()])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);

  await repository().remove("p1", null);

  expect(execute).toHaveBeenCalledTimes(4);
});

it("refuses deletions that are not allowed", async () => {
  query
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([planRow()])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([planRow(GRAPH, { revision: 9 })])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([planRow()])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([["run"]])
    .mockResolvedValueOnce([planRow()])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([["held"]]);
  const journal = vi.fn(async () => {});

  await expect(repository().remove("p1", "u1")).rejects.toMatchObject({
    code: "plan_access_denied",
  });
  await expect(repository().remove("p1", "u2")).rejects.toMatchObject({
    code: "plan_access_denied",
  });
  await expect(
    repository().remove("p1", "u1", { revision: 2, journal }),
  ).rejects.toMatchObject({ code: "plan_conflict" });
  await expect(repository().remove("p1", "u1")).rejects.toMatchObject({
    code: "plan_running",
  });
  await expect(repository().remove("p1", "u1")).rejects.toMatchObject({
    code: "plan_resources_held",
  });
  expect(execute).not.toHaveBeenCalled();
});

it("checks the revision of a plan inside a transaction", async () => {
  const transaction: DatabaseTransaction = { execute, query };
  query
    .mockResolvedValueOnce([[4]])
    .mockResolvedValueOnce([[5]])
    .mockResolvedValueOnce([]);

  await expect(
    requirePlanRevision(transaction, "p1", 4),
  ).resolves.toBeUndefined();
  await expect(requirePlanRevision(transaction, "p1", 4)).rejects.toMatchObject(
    {
      code: "plan_conflict",
    },
  );
  await expect(requirePlanRevision(transaction, "p1", 4)).rejects.toMatchObject(
    {
      code: "plan_conflict",
    },
  );
});
