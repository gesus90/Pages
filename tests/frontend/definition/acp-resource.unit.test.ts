import { expect, it } from "vitest";

import {
  isAcpSessionLimit,
  MAX_ACP_SESSIONS,
  parseAcpSessionLimit,
} from "@/definition/AcpResource";

it("accepts whole session limits from zero up to the ceiling", () => {
  expect(isAcpSessionLimit(0)).toBe(true);
  expect(isAcpSessionLimit(MAX_ACP_SESSIONS)).toBe(true);
});

it("rejects limits that are not whole numbers inside the range", () => {
  expect(isAcpSessionLimit("3")).toBe(false);
  expect(isAcpSessionLimit(1.5)).toBe(false);
  expect(isAcpSessionLimit(-1)).toBe(false);
  expect(isAcpSessionLimit(MAX_ACP_SESSIONS + 1)).toBe(false);
});

it("parses decimal text and keeps numeric input", () => {
  expect(parseAcpSessionLimit(" 12 ")).toBe(12);
  expect(parseAcpSessionLimit(7)).toBe(7);
});

it("refuses empty, fractional, coercible or out-of-range input", () => {
  expect(parseAcpSessionLimit("")).toBeNull();
  expect(parseAcpSessionLimit("1.5")).toBeNull();
  expect(parseAcpSessionLimit("0x10")).toBeNull();
  expect(parseAcpSessionLimit("1000")).toBeNull();
  expect(parseAcpSessionLimit(null)).toBeNull();
});
