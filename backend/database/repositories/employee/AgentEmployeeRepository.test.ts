import { afterEach, expect, it, vi } from "vitest";

import { AgentEmployeeRepository } from "./AgentEmployeeRepository";

import type { AgentEmployeeChange } from "./AgentEmployeeRepository";
import type { Database, DatabaseValue } from "@/backend/database/Database";

function doubleOf(rows: (readonly DatabaseValue[])[]): {
  repository: AgentEmployeeRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new AgentEmployeeRepository({
      query,
      execute,
    } as unknown as Database),
    query,
    execute,
  };
}

function rowOf(overrides: Record<number, DatabaseValue>): DatabaseValue[] {
  const row: DatabaseValue[] = [
    "a1",
    "c1",
    "m1",
    null,
    "yolo",
    "soul",
    "instructions",
    "memory",
    1,
    24n,
    null,
    null,
    null,
    3,
    "created",
    "updated",
    null,
    10,
    "dream",
    4000,
    2000,
    2,
    "days",
    null,
    null,
    0,
    null,
    null,
    null,
    "",
    0,
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

const CHANGE: AgentEmployeeChange = {
  connectionId: "c1",
  model: "m1",
  reasoningEffort: null,
  access: "read_only",
  soul: "s",
  instructions: "i",
  isLearningEnabled: true,
  voiceId: null,
  voiceSpeedTenths: 10,
  memoryCharacters: 1,
  dreamCharacters: 2,
};

afterEach(() => {
  vi.restoreAllMocks();
});

it("returns null for a person", async () => {
  const { repository, query } = doubleOf([]);

  expect(await repository.find("u1")).toBeNull();
  expect(query.mock.calls[0]?.[1]).toEqual({ user_id: "u1" });
});

it("reads a stored agent with defaults", async () => {
  const { repository } = doubleOf([rowOf({})]);

  expect(await repository.find("a1")).toEqual({
    userId: "a1",
    claudeMonthlyCostLimitUsd: null,
    connectionId: "c1",
    model: "m1",
    reasoningEffort: null,
    access: "yolo",
    hasAdministratorRights: false,
    disabledToolGroups: [],
    soul: "soul",
    instructions: "instructions",
    memory: "memory",
    isLearningEnabled: true,
    learningIntervalHours: 24,
    learnedThrough: null,
    lastLearningAt: null,
    lastLearningResult: null,
    revision: 3,
    createdAt: "created",
    updatedAt: "updated",
    voiceId: null,
    voiceSpeedTenths: 10,
    dream: "dream",
    memoryCharacters: 4000,
    dreamCharacters: 2000,
    dreamSchedule: {
      isEnabled: true,
      interval: 2,
      unit: "days",
      time: null,
      weekday: null,
      isOnFullLogbook: false,
    },
    dreamRequest: null,
  });
});

it("reads the limit, tool groups, rights and learning result", async () => {
  const result = {
    status: "updated",
    added: 1,
    merged: -2,
    archived: 1.5,
    removed: 4,
    errorCode: "e",
  };
  const { repository } = doubleOf([
    rowOf({
      12: JSON.stringify(result),
      28: "12.5",
      29: "files,bogus,shell",
      30: 1,
    }),
  ]);

  const stored = await repository.find("a1");

  expect(stored?.claudeMonthlyCostLimitUsd).toBe(12.5);
  expect(stored?.disabledToolGroups).toEqual(["shell", "files"]);
  expect(stored?.hasAdministratorRights).toBe(true);
  expect(stored?.lastLearningResult).toEqual({
    status: "updated",
    added: 1,
    merged: 0,
    archived: 0,
    removed: 4,
    errorCode: "e",
  });
});

it("reads a numeric limit and ignores a negative or odd one", async () => {
  const numeric = doubleOf([rowOf({ 28: 5 })]);
  const negative = doubleOf([rowOf({ 28: -1 })]);
  const text = doubleOf([rowOf({ 28: "abc" })]);

  expect((await numeric.repository.find("a1"))?.claudeMonthlyCostLimitUsd).toBe(
    5,
  );
  expect(
    (await negative.repository.find("a1"))?.claudeMonthlyCostLimitUsd,
  ).toBeNull();
  expect(
    (await text.repository.find("a1"))?.claudeMonthlyCostLimitUsd,
  ).toBeNull();
});

it("drops an implausibly long disabled tool group list", async () => {
  const { repository } = doubleOf([
    rowOf({ 29: Array.from({ length: 13 }, () => "shell").join(",") }),
  ]);

  expect((await repository.find("a1"))?.disabledToolGroups).toEqual([]);
});

it("treats an unreadable learning result as none", async () => {
  for (const text of [
    "{broken",
    "5",
    "null",
    JSON.stringify({ status: "bogus" }),
    JSON.stringify({ status: "failed", errorCode: 1 }),
  ]) {
    const { repository } = doubleOf([rowOf({ 12: text })]);
    const stored = await repository.find("a1");

    if (text.includes("failed"))
      expect(stored?.lastLearningResult?.errorCode).toBeNull();
    else expect(stored?.lastLearningResult).toBeNull();
  }
});

it("rethrows an unexpected parse failure", async () => {
  vi.spyOn(JSON, "parse").mockImplementation(() => {
    throw new Error("unexpected");
  });
  const { repository } = doubleOf([rowOf({ 12: "{}" })]);

  await expect(repository.find("a1")).rejects.toThrow("unexpected");
});

it("rejects an unsupported access level", async () => {
  const { repository } = doubleOf([rowOf({ 4: "root" })]);

  await expect(repository.find("a1")).rejects.toThrow(
    "Database returned an unsupported agent access.",
  );
});

it("lists agents in order", async () => {
  const { repository } = doubleOf([rowOf({}), rowOf({ 0: "a2" })]);

  expect((await repository.list()).map((entry) => entry.userId)).toEqual([
    "a1",
    "a2",
  ]);
});

it("maps account IDs to access levels", async () => {
  const { repository } = doubleOf([
    ["a1", "yolo"],
    ["a2", "workspace"],
  ]);

  expect(await repository.accessLevels()).toEqual(
    new Map([
      ["a1", "yolo"],
      ["a2", "workspace"],
    ]),
  );
});

it("rejects an unsupported access level in the directory", async () => {
  const { repository } = doubleOf([["a1", "root"]]);

  await expect(repository.accessLevels()).rejects.toThrow(
    "Database returned an unsupported agent access.",
  );
});

it("creates an agent with defaults for the optional fields", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.create("a1", CHANGE);

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    user_id: "a1",
    claude_monthly_cost_limit: null,
    has_administrator_rights: null,
    disabled_tool_groups: "",
  });
});

it("creates an agent with given optional fields", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.create("a1", {
    ...CHANGE,
    claudeMonthlyCostLimitUsd: 7,
    hasAdministratorRights: true,
    disabledToolGroups: ["shell", "web"],
  });

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    claude_monthly_cost_limit: 7,
    has_administrator_rights: true,
    disabled_tool_groups: "shell,web",
  });
});

it("updates when the revision matches", async () => {
  const { repository, query } = doubleOf([["a1"]]);

  expect(await repository.update("a1", CHANGE, 3)).toBe(true);
  expect(query.mock.calls[0]?.[1]).toMatchObject({
    revision: 3,
    has_claude_limit: false,
  });
});

it("reports a stale revision on update", async () => {
  const { repository, query } = doubleOf([]);

  expect(
    await repository.update(
      "a1",
      { ...CHANGE, claudeMonthlyCostLimitUsd: null },
      3,
    ),
  ).toBe(false);
  expect(query.mock.calls[0]?.[1]).toMatchObject({ has_claude_limit: true });
});

it("sets the access level", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.setAccessLevel("a1", "yolo");

  expect(execute.mock.calls[0]?.[1]).toEqual({ user_id: "a1", access: "yolo" });
});

it("touches with and without an expected revision", async () => {
  const checked = doubleOf([["a1"]]);
  const unchecked = doubleOf([]);

  expect(await checked.repository.touch("a1", 2)).toBe(true);
  expect(checked.query.mock.calls[0]?.[1]).toEqual({
    user_id: "a1",
    revision: 2,
  });
  expect(await unchecked.repository.touch("a1", null)).toBe(false);
  expect(unchecked.query.mock.calls[0]?.[1]).toEqual({ user_id: "a1" });
});

it("saves memory and dream documents", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.saveMemory("a1", "m");
  await repository.saveDream("a1", "d");

  expect(execute.mock.calls[0]?.[1]).toEqual({ user_id: "a1", memory: "m" });
  expect(execute.mock.calls[1]?.[1]).toEqual({ user_id: "a1", dream: "d" });
});

it("saves a learning result", async () => {
  const { repository, execute } = doubleOf([]);
  const result = {
    status: "unchanged" as const,
    added: 0,
    merged: 0,
    archived: 0,
    removed: 0,
    errorCode: null,
  };

  await repository.saveLearning("a1", {
    learnedThrough: null,
    lastLearningAt: "t",
    result,
  });

  expect(execute.mock.calls[0]?.[1]).toEqual({
    user_id: "a1",
    learned_through: null,
    last_learning_at: "t",
    last_learning_result: JSON.stringify(result),
  });
});
