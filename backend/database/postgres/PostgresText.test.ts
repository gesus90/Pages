import { expect, it } from "vitest";

import { textWithoutNul } from "@/backend/database/postgres/PostgresText";

it("keeps a text without the character", () => {
  expect(textWithoutNul("plain")).toBe("plain");
});

it("removes the character from a text", () => {
  expect(textWithoutNul("a\u0000b")).toBe("ab");
});

it("keeps real escapes at the same place", () => {
  expect(textWithoutNul("x\\u0000y\u0000z")).toBe("x\\u0000yz");
  expect(textWithoutNul("\u0000x\\u0000")).toBe("x\\u0000");
});

it("refuses a removal that would create an escape", () => {
  expect(textWithoutNul("\\\u0000u0000")).toBeNull();
});

it("refuses a removal that would move an escape", () => {
  expect(textWithoutNul("\\u0000\\\u0000u0000")).toBeNull();
});

it("refuses a removal that would turn invalid JSON valid", () => {
  expect(textWithoutNul('{"a":\u00001}')).toBeNull();
});
