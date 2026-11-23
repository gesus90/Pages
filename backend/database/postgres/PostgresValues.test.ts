import { expect, it } from "vitest";

import {
  BYTEA_COLUMN_TYPE,
  createTypeParsers,
} from "@/backend/database/postgres/PostgresValues";

const parsers = createTypeParsers((text) => Buffer.from(text));
const parse = (oid: number, text: string): unknown =>
  (parsers.getTypeParser(oid) as (value: string) => unknown)(text);

it("maps booleans to 0 and 1", () => {
  expect(parse(16, "t")).toBe(1);
  expect(parse(16, "f")).toBe(0);
});

it("maps whole numbers to numbers or bigints", () => {
  expect(parse(20, "12")).toBe(12);
  expect(parse(20, "9223372036854775807")).toBe(9223372036854775807n);
  expect(parse(1700, "42")).toBe(42);
  expect(parse(1700, "-9223372036854775807")).toBe(-9223372036854775807n);
  expect(parse(1700, "1.5")).toBe(1.5);
});

it("maps small integers and floats to numbers", () => {
  for (const oid of [21, 23, 26, 700, 701]) expect(parse(oid, "7")).toBe(7);
});

it("keeps other types as text", () => {
  expect(parse(25, "text")).toBe("text");
});

it("reads binary data through the driver parser", () => {
  expect(BYTEA_COLUMN_TYPE).toBe(17);
  expect(parse(17, "ab")).toEqual(Buffer.from("ab"));
  const broken = createTypeParsers(() => "no");
  expect(() =>
    (broken.getTypeParser(17) as (v: string) => unknown)("x"),
  ).toThrow("unsupported type");
});
