import { expect, it, vi, type Mock } from "vitest";

import {
  clearProjectReferences,
  findReleasedBoardPreferences,
} from "./ProjectReferenceCleanup";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

function databaseOf(
  milestones: DatabaseValue[][],
  preferences: DatabaseValue[][],
): {
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
} {
  const results = [milestones, preferences];
  return {
    execute: vi.fn<DatabaseTransaction["execute"]>(async () => {}),
    query: vi.fn<DatabaseTransaction["query"]>(
      async () => results.shift() ?? [],
    ),
  };
}

it("releases filters that name the project or one of its milestones", async () => {
  const database = databaseOf(
    [["m1"]],
    [
      ["u1", JSON.stringify({ project: "p1", keep: 1 })],
      ["u2", JSON.stringify({ milestone: "m1" })],
      ["u3", JSON.stringify({ project: "other", milestone: "m2" })],
      ["u4", JSON.stringify({ milestone: 5 })],
      ["u5", "not json"],
      ["u6", "[1]"],
      ["u7", "null"],
    ],
  );
  const released = await findReleasedBoardPreferences(database, "p1");
  expect(released.map((entry) => entry.userId)).toEqual(["u1", "u2"]);
  expect(JSON.parse(released[0]?.preferences ?? "")).toMatchObject({
    keep: 1,
  });
});

it("cuts every reference and stores the released preferences", async () => {
  const database = databaseOf([], [["u1", JSON.stringify({ project: "p1" })]]);
  await clearProjectReferences(database, "p1");
  expect(database.execute).toHaveBeenCalledTimes(5);
  expect(database.execute.mock.calls[4]?.[1]).toMatchObject({ user_id: "u1" });
});
