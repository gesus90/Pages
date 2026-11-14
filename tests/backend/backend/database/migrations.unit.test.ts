import { expect, it } from "vitest";

import { POSTGRES_MIGRATIONS } from "@/backend/database/Migrations";

const MIGRATION_NAME = /^(\d{3})_[a-z0-9_]+\.sql$/;

it("embeds the migration scripts of the PostgreSQL schema", () => {
  expect(POSTGRES_MIGRATIONS.length).toBeGreaterThan(0);
  expect(POSTGRES_MIGRATIONS[0]?.name).toBe("001_baseline.sql");
});

it("names every migration with a three-digit number and a readable title", () => {
  const unnamed = POSTGRES_MIGRATIONS.filter(
    (migration) => !MIGRATION_NAME.test(migration.name),
  );

  expect(unnamed).toEqual([]);
});

it("keeps migration names unique and numbers contiguous after the historical 057 batch", () => {
  const names = POSTGRES_MIGRATIONS.map((migration) => migration.name);
  const batch = names.filter((name) => name.startsWith("057_"));
  expect(batch.sort()).toEqual([
    "057_agent_chat_sessions.sql",
    "057_agent_plan_homes.sql",
    "057_business_administration.sql",
    "057_calendar.sql",
    "057_chat_decision_defaults.sql",
    "057_chat_list_collapsed.sql",
    "057_conversation_follow_ups.sql",
  ]);
  expect(new Set(names).size).toBe(names.length);
  const numbers = names
    .filter((name) => !batch.includes(name) || name === batch[0])
    .map((name) => Number(MIGRATION_NAME.exec(name)?.[1]))
    .sort((first, second) => first - second);
  expect(numbers).toEqual(numbers.map((_, index) => index + 1));
});

it("gives every migration a script", () => {
  const empty = POSTGRES_MIGRATIONS.filter(
    (migration) => migration.sql.trim() === "",
  );

  expect(empty).toEqual([]);
});
