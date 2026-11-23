import { expect, it, vi, type Mock } from "vitest";

import { ProjectEventRepository } from "./ProjectEventRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: DatabaseTransaction;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  return { database: { execute, query: async () => rows }, execute };
}

const FIELDS = {
  title: "T",
  description: "D",
  eventDate: "2026-01-01",
  eventTime: null,
  type: "meeting",
};

it("maps events with and without a time", async () => {
  const { database } = databaseOf([
    ["e1", "p1", "T", "D", "2026-01-01", "10:00", "meeting", "c", "u"],
    ["e2", "p1", "T", "D", "2026-01-01", null, "meeting", "c", "u"],
  ]);
  const events = await new ProjectEventRepository(database).findByProjectId(
    "p1",
  );
  expect(events.map((event) => event.eventTime)).toEqual(["10:00", null]);
});

it("rejects a non-text event time", async () => {
  const { database } = databaseOf([
    ["e1", "p1", "T", "D", "2026-01-01", 5, "meeting", "c", "u"],
  ]);
  await expect(
    new ProjectEventRepository(database).findByProjectId("p1"),
  ).rejects.toThrow('"event_time"');
});

it("inserts, updates and archives an event", async () => {
  const { database, execute } = databaseOf();
  const repository = new ProjectEventRepository(database);
  await repository.insert({ id: "e1", projectId: "p1", ...FIELDS });
  await repository.update("e1", FIELDS);
  await repository.archive("e1");
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    id: "e1",
    project_id: "p1",
  });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    id: "e1",
    event_time: null,
  });
  expect(execute.mock.calls[2]?.[1]).toEqual({ id: "e1" });
});
