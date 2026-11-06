import { describe, expect, it } from "vitest";

import {
  checkSetupConnection,
  isSetupDatabaseUrl,
} from "@/backend/setup/SetupConnection";
import {
  canUseDatabaseLocation,
  DATABASE_LOCATION_STATUS as STATUS,
} from "@/definition/Setup";

describe("PostgreSQL setup connection", () => {
  it.each(["postgresql://localhost/pages", "postgres://pages@localhost/pages"])(
    "accepts a PostgreSQL URL %s",
    (input) => {
      expect(isSetupDatabaseUrl(input)).toBe(true);
    },
  );

  it.each([
    "data/pages.duckdb",
    "mysql://localhost/pages",
    "postgresql://host/\u0000",
    `postgresql://host/${"a".repeat(4100)}`,
  ])("rejects an invalid connection %s", (input) => {
    expect(isSetupDatabaseUrl(input)).toBe(false);
  });

  it("reports an empty input without opening a connection", async () => {
    await expect(checkSetupConnection("")).resolves.toBe(STATUS.EMPTY);
  });

  it("refuses invalid input without opening a connection", async () => {
    await expect(checkSetupConnection("pages.txt")).resolves.toBe(
      STATUS.INVALID,
    );
  });

  it("allows only an explicitly checked empty database", () => {
    expect(canUseDatabaseLocation(STATUS.AVAILABLE)).toBe(true);
    for (const status of [
      STATUS.EMPTY,
      STATUS.INVALID,
      STATUS.NOT_WRITABLE,
      STATUS.FOREIGN,
      STATUS.EXISTING,
    ])
      expect(canUseDatabaseLocation(status)).toBe(false);
  });
});
