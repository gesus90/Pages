import { expect, it } from "vitest";

import {
  readCount,
  readPageRecord,
  readScope,
  readSummary,
} from "./WikiPageRows";

import type { DatabaseValue } from "@/backend/database/Database";

const summaryRow: DatabaseValue[] = [
  "id",
  "Title",
  null,
  "project",
  "project-id",
  "Project",
  null,
  "owner",
  null,
  null,
  "u",
  "c",
];

it("reads numbers and bigints and rejects other values", () => {
  expect(readCount([3], 0, "n")).toBe(3);
  expect(readCount([4n], 0, "n")).toBe(4);
  expect(() => readCount(["x"], 0, "n")).toThrow('"n"');
});

it("rejects an unknown scope", () => {
  expect(readScope(["instance"], 0)).toBe("instance");
  expect(() => readScope(["galaxy"], 0)).toThrow('"scope"');
});

it("reads a summary and defaults a missing owner name", () => {
  expect(readSummary(summaryRow)).toEqual({
    id: "id",
    title: "Title",
    icon: null,
    scope: "project",
    projectId: "project-id",
    projectName: "Project",
    parentId: null,
    ownerId: "owner",
    ownerName: "",
    currentUntil: null,
    updatedAt: "u",
    createdAt: "c",
  });
});

it("reads a full page record", () => {
  const record = readPageRecord([
    ...summaryRow,
    "body",
    2,
    1,
    "Editor",
    "attachment:file",
  ]);

  expect(record).toMatchObject({
    content: "body",
    revision: 2,
    isTemplate: true,
    updatedByName: "Editor",
    cover: { kind: "attachment", attachmentId: "file" },
  });
});
