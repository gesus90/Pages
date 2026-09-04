import { describe, expect, it } from "vitest";

import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import type { DuckDBValue } from "@duckdb/node-api";

describe("readTextColumn", () => {
  it("returns the text value at the given index", () => {
    expect(readTextColumn(["user-1", "admin"], 0, "id")).toBe("user-1");
    expect(readTextColumn(["user-1", "admin"], 1, "username")).toBe("admin");
  });

  it("returns empty and unicode strings unchanged", () => {
    expect(readTextColumn([""], 0, "name")).toBe("");
    expect(readTextColumn(["Müller 🚀"], 0, "name")).toBe("Müller 🚀");
  });

  it.each([
    undefined,
    null,
    0,
    1,
    42.5,
    10n,
    true,
    false,
    { value: "admin" },
    ["admin"],
  ])("throws for non-textual value %p", (value) => {
    const row = [value as unknown as DuckDBValue];

    expect(() => readTextColumn(row, 0, "username")).toThrow(
      'Database returned an invalid value for "username".',
    );
  });

  it("throws when the index is out of bounds", () => {
    expect(() => readTextColumn(["admin"], 1, "username")).toThrow(
      'Database returned an invalid value for "username".',
    );
    expect(() => readTextColumn([], 0, "id")).toThrow(
      'Database returned an invalid value for "id".',
    );
  });

  it("mentions the requested column in the error", () => {
    expect(() => readTextColumn([null], 0, "display_name")).toThrow(
      'Database returned an invalid value for "display_name".',
    );
  });
});

describe("readCountColumn", () => {
  it.each([0, 1, 2, 42, 1_000_000])(
    "returns numeric counts unchanged for %p",
    (value) => {
      expect(readCountColumn([value], 0, "user_count")).toBe(value);
    },
  );

  it.each([0n, 1n, 42n, 9_007_199_254_740_991n])(
    "converts bigint counts to numbers for %p",
    (value) => {
      expect(readCountColumn([value], 0, "user_count")).toBe(Number(value));
    },
  );

  it("returns negative and fractional numbers unchanged", () => {
    expect(readCountColumn([-1], 0, "user_count")).toBe(-1);
    expect(readCountColumn([1.5], 0, "user_count")).toBe(1.5);
  });

  it.each(["1", "", null, undefined, true, { count: 1 }])(
    "throws for non-numeric value %p",
    (value) => {
      const row = [value as unknown as DuckDBValue];

      expect(() => readCountColumn(row, 0, "user_count")).toThrow(
        'Database returned an invalid count for "user_count".',
      );
    },
  );

  it("throws when the index is out of bounds", () => {
    expect(() => readCountColumn([], 0, "user_count")).toThrow(
      'Database returned an invalid count for "user_count".',
    );
  });
});
