import { expect, it, vi, type Mock } from "vitest";

import { ProjectDeletionScopeRepository } from "./ProjectDeletionScopeRepository";

import {
  hasAllCounts,
  PROJECT_DELETION_COUNT_KEYS,
  PROJECT_DELETION_DETACHMENT_KEYS,
} from "@/definition/AgentProjectDeletion";

import type * as AgentProjectDeletionModule from "@/definition/AgentProjectDeletion";
import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));
vi.mock("@/definition/AgentProjectDeletion", async (importOriginal) => {
  const original = await importOriginal<typeof AgentProjectDeletionModule>();
  return { ...original, hasAllCounts: vi.fn(original.hasAllCounts) };
});

function databaseOf(rows: (statement: string) => DatabaseValue[][]): {
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
} {
  return {
    execute: vi.fn<DatabaseTransaction["execute"]>(async () => {}),
    query: vi.fn<DatabaseTransaction["query"]>(async (statement: string) =>
      rows(statement),
    ),
  };
}

it("reads the record of a project", async () => {
  const database = databaseOf(() => [["Name", "active", 1]]);
  await expect(
    new ProjectDeletionScopeRepository(database).findRecord("p1"),
  ).resolves.toEqual({ name: "Name", status: "active", isArchived: true });
});

it("returns null for an unknown project", async () => {
  const database = databaseOf(() => []);
  await expect(
    new ProjectDeletionScopeRepository(database).findRecord("p1"),
  ).resolves.toBeNull();
});

it("lists member ids", async () => {
  const database = databaseOf(() => [["u1"], ["u2"]]);
  await expect(
    new ProjectDeletionScopeRepository(database).findMemberIds("p1"),
  ).resolves.toEqual(["u1", "u2"]);
});

it("counts every kind of data and treats a missing row as zero", async () => {
  const database = databaseOf((statement) =>
    statement.includes("FROM milestones WHERE") ? [] : [[4]],
  );
  const counts = await new ProjectDeletionScopeRepository(database).count("p1");
  expect(Object.keys(counts)).toEqual([...PROJECT_DELETION_COUNT_KEYS]);
  expect(counts.milestones).toBe(0);
  expect(counts.tickets).toBe(4);
});

it("fails when a count is missing", async () => {
  vi.mocked(hasAllCounts).mockReturnValueOnce(false);
  const database = databaseOf(() => [[1]]);
  await expect(
    new ProjectDeletionScopeRepository(database).count("p1"),
  ).rejects.toThrow("count of the project deletion is missing");
});

it("counts references and the released board preferences", async () => {
  const database = databaseOf((statement) => {
    if (statement.includes("FROM milestones WHERE")) return [];
    if (statement.includes("user_board_preferences"))
      return [["u1", JSON.stringify({ project: "p1" })]];
    return [[2]];
  });
  const counts = await new ProjectDeletionScopeRepository(
    database,
  ).countDetachments("p1");
  expect(Object.keys(counts)).toEqual([...PROJECT_DELETION_DETACHMENT_KEYS]);
  expect(counts.boardPreferences).toBe(1);
  expect(counts.wikiLinks).toBe(2);
});

it("fails when a detachment count is missing", async () => {
  vi.mocked(hasAllCounts).mockReturnValueOnce(false);
  const database = databaseOf(() => []);
  await expect(
    new ProjectDeletionScopeRepository(database).countDetachments("p1"),
  ).rejects.toThrow("count of the project deletion is missing");
});
