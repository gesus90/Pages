import { expect, it, vi } from "vitest";

import { storedTextForm } from "./StoredTextForm";

import type { DatabaseValue } from "@/backend/database/Database";

function databaseOf(removes: number): {
  database: Parameters<typeof storedTextForm>[0];
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async (): Promise<DatabaseValue[][]> => [[removes]]);
  return { database: { query }, query };
}

it("returns a text without NUL without asking the database", async () => {
  const { database, query } = databaseOf(1);

  await expect(storedTextForm(database, "plain")).resolves.toBe("plain");
  expect(query).not.toHaveBeenCalled();
});

it("removes NUL when the database removes it on save", async () => {
  const { database } = databaseOf(1);

  await expect(storedTextForm(database, "a\u0000b")).resolves.toBe("ab");
});

it("keeps NUL when the database keeps it on save", async () => {
  const { database } = databaseOf(0);

  await expect(storedTextForm(database, "a\u0000b")).resolves.toBe("a\u0000b");
});

it("fails when the database answers no row", async () => {
  const query = vi.fn(async (): Promise<DatabaseValue[][]> => []);

  await expect(storedTextForm({ query }, "a\u0000b")).rejects.toThrow();
});

it("keeps the text when removing NUL would leave valid JSON", async () => {
  const { database } = databaseOf(1);

  await expect(storedTextForm(database, '"a\u0000"')).resolves.toBe(
    '"a\u0000"',
  );
});
