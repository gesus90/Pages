import { expect, it, vi } from "vitest";

import { recordWikiActivity } from "./WikiActivity";

import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}

function repositoryOf(insert: ReturnType<typeof vi.fn>): WikiRepository {
  return doubleOf<WikiRepository>({ activity: { insert } });
}

it("records the activity of a project page", async () => {
  const records: { readonly id: string }[] = [];
  const insert = vi.fn(async (record: { readonly id: string }) => {
    records.push(record);
  });

  await recordWikiActivity(
    repositoryOf(insert),
    { id: "page", projectId: "project" },
    "user",
    "updated",
  );

  expect(records[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(insert).toHaveBeenCalledWith({
    action: "updated",
    category: "wiki",
    id: records[0]?.id,
    message: "Wiki activity.",
    projectId: "project",
    userId: "user",
    wikiPageId: "page",
  });
});

it("records nothing for a page without a project", async () => {
  const insert = vi.fn(async () => {});

  await recordWikiActivity(
    repositoryOf(insert),
    { id: "page", projectId: null },
    "user",
    "updated",
  );

  expect(insert).not.toHaveBeenCalled();
});
