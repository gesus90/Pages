import { expect, it } from "vitest";

import {
  readOptionalCountColumn,
  readOptionalTextColumn,
} from "./OptionalColumn";

it("reads text and keeps NULL as null", () => {
  expect(readOptionalTextColumn(["x"], 0, "c")).toBe("x");
  expect(readOptionalTextColumn([null], 0, "c")).toBeNull();
});

it("rejects a missing or non-text column", () => {
  expect(() => readOptionalTextColumn([], 0, "c")).toThrow('"c"');
  expect(() => readOptionalTextColumn([1], 0, "c")).toThrow('"c"');
});

it("reads counts and keeps NULL as null", () => {
  expect(readOptionalCountColumn([3], 0, "c")).toBe(3);
  expect(readOptionalCountColumn([4n], 0, "c")).toBe(4);
  expect(readOptionalCountColumn([null], 0, "c")).toBeNull();
});

it("rejects a missing or non-numeric count", () => {
  expect(() => readOptionalCountColumn([], 0, "c")).toThrow('"c"');
  expect(() => readOptionalCountColumn(["x"], 0, "c")).toThrow('"c"');
});
