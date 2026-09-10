import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readDatabaseStats,
  recordDatabaseQuery,
  resetDatabaseStats,
} from "@/backend/database/DatabaseStats";

const originalNodeEnv = process.env.NODE_ENV;
const originalSlowQueryMs = process.env.PAGES_SLOW_QUERY_MS;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("DatabaseStats", () => {
  beforeEach(() => {
    delete process.env.PAGES_SLOW_QUERY_MS;
  });

  afterEach(() => {
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv("PAGES_SLOW_QUERY_MS", originalSlowQueryMs);
    vi.restoreAllMocks();
  });

  it("resets and reports aggregate counters", () => {
    resetDatabaseStats();

    expect(readDatabaseStats()).toEqual({ queries: 0, totalMs: 0 });

    recordDatabaseQuery("SELECT 1", 5);

    expect(readDatabaseStats()).toEqual({ queries: 1, totalMs: 5 });

    resetDatabaseStats();

    expect(readDatabaseStats()).toEqual({ queries: 0, totalMs: 0 });
  });

  it("logs slow queries in development above the configured threshold", () => {
    process.env.NODE_ENV = "development";
    process.env.PAGES_SLOW_QUERY_MS = "10";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    recordDatabaseQuery("SELECT 1", 5);
    recordDatabaseQuery("SELECT * FROM users", 15);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("[pages][slow-query]");
  });

  it("uses a 50ms default threshold when the configuration is unset", () => {
    process.env.NODE_ENV = "development";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    recordDatabaseQuery("SELECT 1", 40);
    recordDatabaseQuery("SELECT 1", 60);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default threshold for negative and non-numeric values", () => {
    process.env.NODE_ENV = "development";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    process.env.PAGES_SLOW_QUERY_MS = "-5";
    recordDatabaseQuery("SELECT 1", 40);
    expect(warn).not.toHaveBeenCalled();

    process.env.PAGES_SLOW_QUERY_MS = "not-a-number";
    recordDatabaseQuery("SELECT 1", 40);
    expect(warn).not.toHaveBeenCalled();
  });

  it("never logs in non-development environments", () => {
    process.env.NODE_ENV = "production";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    recordDatabaseQuery("SELECT 1", 5000);

    expect(warn).not.toHaveBeenCalled();
  });
});
