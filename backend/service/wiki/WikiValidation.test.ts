import { expect, it } from "vitest";

import { WikiValidationError } from "@/backend/error/WikiErrors";

import {
  normalizeDate,
  normalizeIcon,
  normalizeTitle,
  validateContent,
} from "./WikiValidation";

it("normalizes a title to a single line", () => {
  expect(normalizeTitle("  A \n  title ")).toBe("A title");
});

it("rejects an empty title", () => {
  expect(() => normalizeTitle("  ")).toThrow(WikiValidationError);
});

it("rejects a title that is too long", () => {
  expect(() => normalizeTitle("a".repeat(201))).toThrow(WikiValidationError);
  expect(normalizeTitle("a".repeat(200))).toHaveLength(200);
});

it("accepts content within the limit and rejects more", () => {
  expect(validateContent("text")).toBe("text");
  expect(() => validateContent("a".repeat(1_048_577))).toThrow(
    WikiValidationError,
  );
});

it("treats an empty icon as none", () => {
  expect(normalizeIcon(null)).toBeNull();
  expect(normalizeIcon("  ")).toBeNull();
});

it("accepts a single emoji", () => {
  expect(normalizeIcon(" 📘 ")).toBe("📘");
});

it("rejects text and over-long icons", () => {
  expect(() => normalizeIcon("abc")).toThrow(WikiValidationError);
  expect(() => normalizeIcon("📘".repeat(17))).toThrow(WikiValidationError);
});

it("treats an empty date as none", () => {
  expect(normalizeDate(null)).toBeNull();
  expect(normalizeDate(" ")).toBeNull();
});

it("accepts a real calendar date", () => {
  expect(normalizeDate(" 2026-02-28 ")).toBe("2026-02-28");
});

it("rejects malformed and impossible dates", () => {
  expect(() => normalizeDate("2026-02-30")).toThrow(WikiValidationError);
  expect(() => normalizeDate("2026-13-01")).toThrow(WikiValidationError);
  expect(() => normalizeDate("nonsense")).toThrow(WikiValidationError);
  expect(() => normalizeDate("+12026-01-01")).toThrow(WikiValidationError);
});
