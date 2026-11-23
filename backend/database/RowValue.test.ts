import { expect, it } from "vitest";

import {
  readBlobColumn,
  readBooleanColumn,
  readCountColumn,
  readIdListColumn,
  readNullableBooleanColumn,
  readNullableCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

it("reads text and rejects other values", () => {
  expect(readTextColumn(["a"], 0, "name")).toBe("a");
  expect(() => readTextColumn([1], 0, "name")).toThrow('"name"');
  expect(() => readTextColumn([], 0, "name")).toThrow('"name"');
});

it("reads nullable text", () => {
  expect(readNullableTextColumn(["a"], 0, "n")).toBe("a");
  expect(readNullableTextColumn([null], 0, "n")).toBeNull();
  expect(readNullableTextColumn([], 0, "n")).toBeNull();
  expect(() => readNullableTextColumn([2], 0, "n")).toThrow('"n"');
});

it("reads binary data", () => {
  const blob = Buffer.from("x");
  expect(readBlobColumn([blob], 0, "b")).toBe(blob);
  expect(() => readBlobColumn(["x"], 0, "b")).toThrow('"b"');
});

it("reads booleans stored as 0 and 1", () => {
  expect(readBooleanColumn([1], 0, "f")).toBe(true);
  expect(readBooleanColumn([0], 0, "f")).toBe(false);
  expect(() => readBooleanColumn([2], 0, "f")).toThrow('"f"');
});

it("reads nullable booleans", () => {
  expect(readNullableBooleanColumn([1], 0, "f")).toBe(true);
  expect(readNullableBooleanColumn([0], 0, "f")).toBe(false);
  expect(readNullableBooleanColumn([null], 0, "f")).toBeNull();
  expect(readNullableBooleanColumn([], 0, "f")).toBeNull();
  expect(() => readNullableBooleanColumn(["1"], 0, "f")).toThrow('"f"');
});

it("reads counts", () => {
  expect(readCountColumn([BigInt(4)], 0, "c")).toBe(4);
  expect(readCountColumn([5], 0, "c")).toBe(5);
  expect(() => readCountColumn(["5"], 0, "c")).toThrow("invalid count");
});

it("reads nullable counts", () => {
  expect(readNullableCountColumn([null], 0, "c")).toBeNull();
  expect(readNullableCountColumn([], 0, "c")).toBeNull();
  expect(readNullableCountColumn([3], 0, "c")).toBe(3);
});

it("reads a list of ids", () => {
  expect(readIdListColumn(['["a","b"]'], 0, "ids")).toEqual(["a", "b"]);
  expect(() => readIdListColumn(['{"a":1}'], 0, "ids")).toThrow('"ids"');
  expect(() => readIdListColumn(["[1]"], 0, "ids")).toThrow('"ids"');
});
