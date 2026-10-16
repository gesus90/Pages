import { expect, it } from "vitest";

import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";

const MIGRATION_NAME = /^(\d{3})_[a-z0-9_]+\.sql$/;

it("embeds the migration scripts of the DuckDB schema", () => {
  expect(DATABASE_MIGRATIONS.length).toBeGreaterThan(0);
  expect(DATABASE_MIGRATIONS[0]?.name).toBe("001_baseline.sql");
});

it("names every migration with a three-digit number and a readable title", () => {
  const unnamed = DATABASE_MIGRATIONS.filter(
    (migration) => !MIGRATION_NAME.test(migration.name),
  );

  expect(unnamed).toEqual([]);
});

it("numbers the migrations without gaps or duplicates", () => {
  const numbers = DATABASE_MIGRATIONS.map((migration) =>
    Number(MIGRATION_NAME.exec(migration.name)?.[1]),
  ).sort((first, second) => first - second);

  expect(numbers).toEqual(numbers.map((_, index) => index + 1));
});

it("gives every migration a script", () => {
  const empty = DATABASE_MIGRATIONS.filter(
    (migration) => migration.sql.trim() === "",
  );

  expect(empty).toEqual([]);
});
