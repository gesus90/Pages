import { expect, it, vi, type Mock } from "vitest";

import { ProjectIconRepository } from "./ProjectIconRepository";

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

it("returns null when the project has no icon", async () => {
  const { database } = databaseOf();
  await expect(
    new ProjectIconRepository(database).findByProjectId("p1"),
  ).resolves.toBeNull();
});

it("maps the icon row", async () => {
  const content = Buffer.from("png");
  const { database } = databaseOf([["image/png", "icon.png", content]]);
  await expect(
    new ProjectIconRepository(database).findByProjectId("p1"),
  ).resolves.toEqual({
    data: content,
    filename: "icon.png",
    mimeType: "image/png",
  });
});

it("upserts the icon with its parameters", async () => {
  const { database, execute } = databaseOf();
  const content = Buffer.from("x");
  await new ProjectIconRepository(database).upsert("p1", {
    data: content,
    filename: "f.png",
    mimeType: "image/png",
  });
  expect(execute.mock.calls[0]?.[1]).toEqual({
    project_id: "p1",
    mime_type: "image/png",
    filename: "f.png",
    data: content,
  });
});
