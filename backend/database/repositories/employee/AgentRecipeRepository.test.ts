import { afterEach, expect, it, vi } from "vitest";

import { AgentRecipeRepository } from "./AgentRecipeRepository";

import type { AgentRecipeContent } from "./AgentRecipeRepository";
import type { Database } from "@/backend/database/Database";

function doubleOf(rows: unknown[][]): {
  repository: AgentRecipeRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new AgentRecipeRepository({
      query,
      execute,
    } as unknown as Database),
    query,
    execute,
  };
}

const content: AgentRecipeContent = {
  name: "n",
  kind: "flow",
  summary: "s",
  keywords: ["k"],
  parameters: [{ name: "p", description: "d" }],
  steps: [{ tool: "t", input: { a: 1 }, note: "x" }],
  body: "b",
  evidence: "e",
  confirmedOn: "2026-01-01",
  strength: 3,
};

function rowOf(overrides: Record<number, unknown> = {}): unknown[] {
  const row: unknown[] = [
    "r1",
    "a1",
    "n",
    "flow",
    "s",
    '["k"]',
    '[{"name":"p","description":"d"}]',
    '[{"tool":"t","input":{"a":1},"note":"x"}]',
    "b",
    "e",
    "2026-01-01",
    3,
    4,
    "2026-01-02T00:00:00Z",
    1,
    null,
    0,
    null,
    "manual",
    "2026-01-01 00:00:00",
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("lists recipes with every field read", async () => {
  const { repository, query } = doubleOf([rowOf()]);

  expect(await repository.list("a1")).toEqual([
    {
      id: "r1",
      agentId: "a1",
      name: "n",
      kind: "flow",
      summary: "s",
      keywords: ["k"],
      parameters: content.parameters,
      steps: content.steps,
      body: "b",
      evidence: "e",
      confirmedOn: "2026-01-01",
      strength: 3,
      useCount: 4,
      lastUsedAt: "2026-01-02T00:00:00Z",
      isActive: true,
      disabledReason: null,
      failureStreak: 0,
      lastError: null,
      origin: "manual",
      createdAt: "2026-01-01 00:00:00",
    },
  ]);
  expect(query.mock.calls[0]?.[1]).toEqual({ agent_id: "a1" });
});

it("falls back for unknown kind, reason, origin and unreadable JSON", async () => {
  const { repository } = doubleOf([
    rowOf({
      3: "other",
      5: "{",
      6: '[{"name":1}]',
      7: "not json",
      14: 0,
      15: "failed",
      18: "dream",
    }),
    rowOf({ 15: "manual" }),
    rowOf({ 15: "weird" }),
  ]);

  const [first, second, third] = await repository.list("a1");

  expect(first).toMatchObject({
    kind: "knowledge",
    keywords: [],
    parameters: [],
    steps: [],
    isActive: false,
    disabledReason: "failed",
    origin: "dream",
  });
  expect(second?.disabledReason).toBe("manual");
  expect(third?.disabledReason).toBeNull();
});

it("rethrows an unexpected parse failure", async () => {
  const { repository } = doubleOf([rowOf()]);
  vi.spyOn(JSON, "parse").mockImplementation(() => {
    throw new Error("boom");
  });

  await expect(repository.list("a1")).rejects.toThrow("boom");
});

it("returns only active recipes", async () => {
  const { repository } = doubleOf([rowOf(), rowOf({ 0: "r2", 14: 0 })]);

  const recipes = await repository.active("a1");

  expect(recipes.map((recipe) => recipe.id)).toEqual(["r1"]);
});

it("finds a recipe by name and id", async () => {
  const found = doubleOf([rowOf()]);
  const missing = doubleOf([]);

  expect((await found.repository.findByName("a1", "n"))?.id).toBe("r1");
  expect((await found.repository.findById("a1", "r1"))?.id).toBe("r1");
  expect(await missing.repository.findByName("a1", "n")).toBeNull();
  expect(await missing.repository.findById("a1", "r1")).toBeNull();
});

it("inserts a recipe with serialized content", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.insert({
    ...content,
    id: "r1",
    agentId: "a1",
    origin: "dream",
  });

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    id: "r1",
    agent_id: "a1",
    origin: "dream",
    keywords: '["k"]',
    strength: 3,
  });
});

it("updates a recipe and reports whether it exists", async () => {
  const found = doubleOf([["r1"]]);

  expect(
    await found.repository.update("a1", "r1", content, { reactivate: true }),
  ).toBe(true);
  expect(found.query.mock.calls[0]?.[1]).toMatchObject({
    reactivate: true,
    name: "n",
  });
  expect(
    await doubleOf([]).repository.update("a1", "r1", content, {
      reactivate: false,
    }),
  ).toBe(false);
});

it("switches a recipe on or off", async () => {
  expect(await doubleOf([["r1"]]).repository.setActive("a1", "r1", true)).toBe(
    true,
  );
  expect(await doubleOf([]).repository.setActive("a1", "r1", false)).toBe(
    false,
  );
});

it("records a use", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.recordUse("a1", "r1", "t");

  expect(execute.mock.calls[0]?.[1]).toEqual({
    agent_id: "a1",
    id: "r1",
    at: "t",
  });
});

it("records a failure and reports its outcome", async () => {
  const { repository, query } = doubleOf([[3, 0]]);

  expect(
    await repository.recordFailure("a1", "r1", { error: "e", limit: 3 }),
  ).toEqual({ failureStreak: 3, isActive: false });
  expect(query.mock.calls[0]?.[1]).toEqual({
    agent_id: "a1",
    id: "r1",
    error: "e",
    limit: 3,
  });
  expect(
    await doubleOf([]).repository.recordFailure("a1", "r1", {
      error: "e",
      limit: 3,
    }),
  ).toBeNull();
});

it("removes recipes and counts them", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([["a"]])
    .mockResolvedValueOnce([]);
  const repository = new AgentRecipeRepository({
    query,
    execute: vi.fn(),
  });

  expect(await repository.remove("a1", ["a", "b"])).toBe(1);
  expect(query).toHaveBeenCalledTimes(2);
});
