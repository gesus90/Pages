import { expect, it } from "vitest";

import { ChatViewPreferenceRepository } from "@/backend/database/repositories/conversation/ChatViewPreferenceRepository";

import { scriptedDatabase } from "./scripted-database";

it("reads the collapsed list of a person and expanded without a row (PAGE-325)", async () => {
  const scripted = scriptedDatabase();
  scripted.answer([[1]], [[0]], []);
  const repository = new ChatViewPreferenceRepository(scripted.database);

  await expect(repository.isListCollapsed("user-1")).resolves.toBe(true);
  await expect(repository.isListCollapsed("user-2")).resolves.toBe(false);
  await expect(repository.isListCollapsed("user-3")).resolves.toBe(false);
  expect(scripted.statements.map((entry) => entry.parameters)).toEqual([
    { user_id: "user-1" },
    { user_id: "user-2" },
    { user_id: "user-3" },
  ]);
});

it("upserts the list state without touching the split width", async () => {
  const scripted = scriptedDatabase();
  const repository = new ChatViewPreferenceRepository(scripted.database);

  await repository.setListCollapsed("user-1", true, "2026-11-13T10:00:00Z");
  await repository.setListCollapsed("user-1", false, "2026-11-13T10:01:00Z");

  const [collapsed, expanded] = scripted.ofKind("execute");
  expect(collapsed?.statement).toContain("ON CONFLICT (user_id) DO UPDATE");
  expect(collapsed?.statement).not.toContain("split_width");
  expect(collapsed?.parameters).toEqual({
    user_id: "user-1",
    list_collapsed: 1,
    updated_at: "2026-11-13T10:00:00Z",
  });
  expect(expanded?.parameters).toMatchObject({ list_collapsed: 0 });
});

it("reads no split width from a row that only holds the list state", async () => {
  const scripted = scriptedDatabase();
  scripted.answer([[null]], [[640]], []);
  const repository = new ChatViewPreferenceRepository(scripted.database);

  await expect(repository.splitWidth("user-1")).resolves.toBeNull();
  await expect(repository.splitWidth("user-1")).resolves.toBe(640);
  await expect(repository.splitWidth("user-2")).resolves.toBeNull();
});
