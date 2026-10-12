import { expect, it } from "vitest";

import {
  normalizePairingCode,
  pairingText,
  pairingValidity,
} from "@/backend/service/mcp/PairingValidation";

it.each(["BCDF-GHJK", "bcdfghjk", " bcdf - ghjk ", "BCDF\tGHJK"])(
  "normalizes the human pairing code %j",
  (input) => {
    expect(normalizePairingCode(input)).toBe("BCDFGHJK");
  },
);

it.each([
  undefined,
  null,
  123,
  {},
  "",
  "AIOO-0000",
  "BCDFGHJ",
  "BCDFGHJKL",
  "B".repeat(65),
])("returns no code for invalid input %j", (input) => {
  expect(normalizePairingCode(input)).toBe("");
});

it("trims labels and enforces their exact length limits", () => {
  expect(pairingText("  Pages MCP  ")).toBe("Pages MCP");
  expect(pairingText("a".repeat(100))).toHaveLength(100);
  expect(pairingText("a".repeat(32), 32)).toHaveLength(32);
});

it.each([
  undefined,
  null,
  123,
  "",
  " ",
  "a".repeat(101),
  "line\nfeed",
  "null\0byte",
  "hidden\u200btext",
])("rejects labels without reflecting untrusted content %j", (input) => {
  expect(() => pairingText(input)).toThrow(
    expect.objectContaining({
      code: "invalid_request",
      status: 400,
    }),
  );
});

it("applies the shorter package-version label limit", () => {
  expect(() => pairingText("a".repeat(33), 32)).toThrow(
    expect.objectContaining({ code: "invalid_request" }),
  );
});

it.each([0, 1, 30, 365])("accepts validity %j days", (input) => {
  expect(pairingValidity(input)).toBe(input);
});

it.each([undefined, null, "30", -1, 366, 1.5, NaN, Infinity])(
  "rejects invalid validity %j",
  (input) => {
    expect(() => pairingValidity(input)).toThrow(
      expect.objectContaining({ code: "invalid_request" }),
    );
  },
);
