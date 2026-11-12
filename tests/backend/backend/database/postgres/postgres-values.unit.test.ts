import { describe, expect, it, vi } from "vitest";

import {
  BYTEA_COLUMN_TYPE,
  createTypeParsers,
} from "@/backend/database/postgres/PostgresValues";

describe("PostgreSQL value parsers", () => {
  it("preserves whole numbers beyond the safe integer range", () => {
    const parsers = createTypeParsers(() => Buffer.alloc(0));
    expect(parsers.getTypeParser(20)("9007199254740991")).toBe(
      9007199254740991,
    );
    expect(parsers.getTypeParser(20)("-9007199254740992")).toBe(
      -9007199254740992n,
    );
    expect(parsers.getTypeParser(1700)("9007199254740992")).toBe(
      9007199254740992n,
    );
    expect(parsers.getTypeParser(1700)("12.5")).toBe(12.5);
    expect(parsers.getTypeParser(1700)("1e3")).toBe(1000);
  });

  it("maps numeric and boolean columns and leaves unknown types as text", () => {
    const parsers = createTypeParsers(() => Buffer.alloc(0));
    for (const oid of [21, 23, 26, 700, 701]) {
      expect(parsers.getTypeParser(oid)("42.5")).toBe(42.5);
    }
    expect(parsers.getTypeParser(16)("t")).toBe(1);
    expect(parsers.getTypeParser(16)("f")).toBe(0);
    expect(parsers.getTypeParser(114)('{"a":1}')).toBe('{"a":1}');
  });

  it("delegates bytea decoding and rejects a non-buffer result", () => {
    const bytes = Buffer.from([0, 255]);
    const readBytes = vi
      .fn()
      .mockReturnValueOnce(bytes)
      .mockReturnValueOnce("bad");
    const parse = createTypeParsers(readBytes).getTypeParser(BYTEA_COLUMN_TYPE);
    expect(parse("encoded")).toBe(bytes);
    expect(readBytes).toHaveBeenCalledWith("encoded");
    expect(() => parse("invalid")).toThrow("unsupported type");
  });
});
