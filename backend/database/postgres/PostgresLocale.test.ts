import { expect, it, vi } from "vitest";

import {
  PostgresLocaleError,
  requireByteOrderedDatabase,
} from "@/backend/database/postgres/PostgresLocale";

import type { DatabaseEngine } from "@/backend/database/DatabaseEngine";

function engineWith(rows: (string | null)[][]): DatabaseEngine {
  return {
    read: vi.fn(() => Promise.resolve(rows)),
  } as unknown as DatabaseEngine;
}

it.each([
  ["UTF8", "c", "C.UTF-8", "C.UTF-8"],
  ["UTF8", "c", "C", "C.utf8"],
])("accepts %s %s %s %s", async (...row) => {
  await expect(
    requireByteOrderedDatabase(engineWith([row])),
  ).resolves.toBeUndefined();
});

it.each([
  [[]],
  [[["LATIN1", "c", "C", "C.UTF-8"]]],
  [[["UTF8", "i", "C", "C.UTF-8"]]],
  [[["UTF8", "c", "de_DE", "C.UTF-8"]]],
  [[["UTF8", "c", "C", "C"]]],
])("refuses %j", async (rows) => {
  const refusal = requireByteOrderedDatabase(engineWith(rows));
  await expect(refusal).rejects.toBeInstanceOf(PostgresLocaleError);
  await expect(refusal).rejects.toThrow("C.UTF-8");
});
