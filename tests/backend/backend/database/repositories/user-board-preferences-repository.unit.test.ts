import { expect, it } from "vitest";

import { UserBoardPreferencesRepository } from "@/backend/database/repositories/UserBoardPreferencesRepository";

import { scriptedDatabase } from "./scripted-database";

it("returns the stored board preferences of a user and null when none were saved", async () => {
  const scripted = scriptedDatabase();
  scripted.answer([['{"columns":["todo"]}']], []);
  const repository = new UserBoardPreferencesRepository(scripted.database);

  await expect(repository.findByUserId("user-1")).resolves.toBe(
    '{"columns":["todo"]}',
  );
  await expect(repository.findByUserId("user-2")).resolves.toBeNull();
  expect(scripted.statements.map((entry) => entry.parameters)).toEqual([
    { user_id: "user-1" },
    { user_id: "user-2" },
  ]);
});

it("upserts the preferences text of a user", async () => {
  const scripted = scriptedDatabase();

  await new UserBoardPreferencesRepository(scripted.database).upsert(
    "user-1",
    "{}",
  );

  const statement: unknown = expect.stringContaining(
    "ON CONFLICT (user_id) DO UPDATE",
  );
  expect(scripted.statements).toEqual([
    expect.objectContaining({
      kind: "execute",
      statement,
      parameters: { preferences: "{}", user_id: "user-1" },
    }),
  ]);
});
