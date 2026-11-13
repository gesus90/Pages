import { describe, expect, it, vi } from "vitest";

import {
  PostgresLocaleError,
  requireByteOrderedDatabase,
} from "@/backend/database/postgres/PostgresLocale";

import type { DatabaseEngine } from "@/backend/database/DatabaseEngine";

describe("PostgreSQL database locale", () => {
  it.each(["C.UTF-8", "C.utf8"])(
    "accepts UTF8 libc with %s character types",
    async (locale) => {
      const read = vi.fn().mockResolvedValue([["UTF8", "c", "C", locale]]);
      const engine = { read } as unknown as DatabaseEngine;
      await expect(requireByteOrderedDatabase(engine)).resolves.toBeUndefined();
      expect(read).toHaveBeenCalledWith(
        expect.stringContaining("pg_database"),
        {},
      );
    },
  );

  it.each([
    [],
    [["LATIN1", "c", "C", "C.UTF-8"]],
    [["UTF8", "i", "C", "C.UTF-8"]],
    [["UTF8", "c", "de_DE", "C.UTF-8"]],
    [["UTF8", "c", "C", "C"]],
  ])("rejects incompatible locale rows %j", async (...rows) => {
    const read = vi.fn().mockResolvedValue(rows);
    const engine = { read } as unknown as DatabaseEngine;
    await expect(requireByteOrderedDatabase(engine)).rejects.toBeInstanceOf(
      PostgresLocaleError,
    );
  });
});
