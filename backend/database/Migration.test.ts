import { expect, it } from "vitest";

import {
  MigrationChecksumError,
  UnknownMigrationError,
  createMigrationChecksum,
} from "@/backend/database/Migration";
import { POSTGRES_MIGRATIONS } from "@/backend/database/Migrations";

it("computes the same checksum for both line-ending styles", () => {
  expect(createMigrationChecksum("a\r\nb")).toBe(
    createMigrationChecksum("a\nb"),
  );
  expect(createMigrationChecksum("a")).toMatch(/^[0-9a-f]{64}$/u);
});

it("names the migration in its errors", () => {
  const changed = new MigrationChecksumError("001.sql");
  expect(changed.name).toBe("MigrationChecksumError");
  expect(changed.message).toContain('"001.sql"');
  const unknown = new UnknownMigrationError("999.sql");
  expect(unknown.name).toBe("UnknownMigrationError");
  expect(unknown.message).toContain('"999.sql"');
});

it("embeds the SQL migrations by file name", () => {
  expect(POSTGRES_MIGRATIONS.length).toBeGreaterThan(0);
  expect(POSTGRES_MIGRATIONS[0]?.name).toMatch(/^\d+_.+\.sql$/u);
  expect(POSTGRES_MIGRATIONS[0]?.sql.length).toBeGreaterThan(0);
});
