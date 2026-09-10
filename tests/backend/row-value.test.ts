import { describe, expect, it } from "vitest";

import {
  readBlobColumn,
  readBooleanColumn,
  readCountColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { DatabaseValue } from "@/backend/database/Database";

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
    const row = [value as unknown as DatabaseValue];

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

describe("readBlobColumn", () => {
  it("returns binary data at the given index", () => {
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

    expect(readBlobColumn(["project-1", image], 1, "data")).toBe(image);
  });

  it.each([undefined, null, "image", 0, 1n, true, {}, []])(
    "throws for non-binary value %p",
    (value) => {
      const row = [value as unknown as DatabaseValue];

      expect(() => readBlobColumn(row, 0, "data")).toThrow(
        'Database returned an invalid value for "data".',
      );
    },
  );

  it("throws when the index is out of bounds", () => {
    expect(() => readBlobColumn([], 0, "data")).toThrow(
      'Database returned an invalid value for "data".',
    );
  });
});

describe("readBooleanColumn", () => {
  it("reads SQLite integers as booleans", () => {
    expect(readBooleanColumn([1], 0, "is_active")).toBe(true);
    expect(readBooleanColumn([0], 0, "is_active")).toBe(false);
  });

  it("reads the value at the given index", () => {
    expect(readBooleanColumn(["user-1", 1], 1, "is_active")).toBe(true);
    expect(readBooleanColumn(["user-1", 0], 1, "is_active")).toBe(false);
  });

  it.each([null, undefined, "1", "true", 2, -1, 1.5, 10n, true, false])(
    "throws for non-binary value %p",
    (value) => {
      const row = [value as unknown as DatabaseValue];

      expect(() => readBooleanColumn(row, 0, "is_active")).toThrow(
        'Database returned an invalid value for "is_active".',
      );
    },
  );

  it("throws when the index is out of bounds", () => {
    expect(() => readBooleanColumn([], 0, "is_active")).toThrow(
      'Database returned an invalid value for "is_active".',
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
      const row = [value as unknown as DatabaseValue];

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
