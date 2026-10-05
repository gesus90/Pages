import { describe, expect, it } from "vitest";

import {
  createMigrationChecksum,
  MigrationChecksumError,
  UnknownMigrationError,
} from "@/backend/database/Migration";

describe("createMigrationChecksum", () => {
  it("is stable for identical scripts", () => {
    expect(createMigrationChecksum("SELECT 1;")).toBe(
      createMigrationChecksum("SELECT 1;"),
    );
  });

  it("differs for different scripts", () => {
    expect(createMigrationChecksum("SELECT 1;")).not.toBe(
      createMigrationChecksum("SELECT 2;"),
    );
  });

  it("ignores the line-ending style of the checkout", () => {
    expect(createMigrationChecksum("SELECT 1;\r\nSELECT 2;\r\n")).toBe(
      createMigrationChecksum("SELECT 1;\nSELECT 2;\n"),
    );
  });
});

describe("migration errors", () => {
  it("names the edited migration", () => {
    const error = new MigrationChecksumError("001_baseline.sql");

    expect(error.name).toBe("MigrationChecksumError");
    expect(error.message).toContain('"001_baseline.sql"');
    expect(error.message).toContain("new migration");
  });

  it("names the migration that is unknown to this version", () => {
    const error = new UnknownMigrationError("009_future.sql");

    expect(error.name).toBe("UnknownMigrationError");
    expect(error.message).toContain('"009_future.sql"');
    expect(error.message).toContain("newer version");
  });
});
