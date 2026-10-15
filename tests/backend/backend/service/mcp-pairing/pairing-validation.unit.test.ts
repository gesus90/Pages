import { describe, expect, it } from "vitest";

import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import {
  normalizePairingCode,
  pairingText,
  pairingValidity,
} from "@/backend/service/mcp/PairingValidation";

import { thrownBy } from "./pairing-world";

describe("normalizePairingCode", () => {
  it("accepts the eight consonants of the code alphabet", () => {
    expect(normalizePairingCode("BCDFGHJK")).toBe("BCDFGHJK");
  });

  it("removes the display dash and any whitespace and uppercases", () => {
    expect(normalizePairingCode("bcdf-ghjk")).toBe("BCDFGHJK");
    expect(normalizePairingCode(" bcdf ghjk\n")).toBe("BCDFGHJK");
  });

  it.each([
    ["too short", "BCDFGHJ"],
    ["too long", "BCDFGHJKL"],
    ["empty", ""],
    ["a vowel", "BCDFGHJA"],
    ["a digit", "BCDFGHJ1"],
    ["a consonant outside the alphabet", "BCDFGHJY"],
    ["punctuation", "BCDFGHJ_"],
  ])("answers the empty code for %s", (_, input) => {
    expect(normalizePairingCode(input)).toBe("");
  });

  it("refuses a long input even when it would reduce to a valid code", () => {
    const padded = `BCDFGHJK${" ".repeat(57)}`;

    expect(padded).toHaveLength(65);
    expect(normalizePairingCode(padded)).toBe("");
    expect(normalizePairingCode(padded.slice(0, 64))).toBe("BCDFGHJK");
  });

  it.each([[null], [undefined], [12345678], [{}], [["BCDFGHJK"]]])(
    "answers the empty code for the non-string %j",
    (input) => {
      expect(normalizePairingCode(input)).toBe("");
    },
  );
});

describe("pairingText", () => {
  it("returns the trimmed text", () => {
    expect(pairingText("  Work laptop  ")).toBe("Work laptop");
  });

  it("accepts exactly the maximum length and refuses one more", () => {
    expect(pairingText("a".repeat(100))).toHaveLength(100);
    expect(thrownBy(() => pairingText("a".repeat(101)))).toBeInstanceOf(
      McpAuthorizationError,
    );
  });

  it("counts the trimmed length, not the padding", () => {
    expect(pairingText(` ${"a".repeat(100)} `)).toHaveLength(100);
  });

  it("honors a smaller maximum", () => {
    expect(pairingText("1.2.3", 5)).toBe("1.2.3");
    expect(thrownBy(() => pairingText("1.2.3.4", 5))).toMatchObject({
      code: "invalid_request",
    });
  });

  it.each([
    ["empty text", ""],
    ["blank text", "   "],
    ["a line break", "first\nsecond"],
    ["a tab", "first\tsecond"],
    ["a null character", "first\u0000second"],
    ["a zero-width character", "first​second"],
    ["a bidirectional override", "first‮second"],
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
  ])("refuses %s", (_, input) => {
    expect(thrownBy(() => pairingText(input))).toMatchObject({
      code: "invalid_request",
      status: 400,
    });
  });

  it("keeps the rejected content out of the public message", () => {
    const error = thrownBy(() => pairingText("secret\nvalue"));

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain("secret");
  });

  it("accepts non-ASCII letters", () => {
    expect(pairingText("Büro-Rechner")).toBe("Büro-Rechner");
  });
});

describe("pairingValidity", () => {
  it.each([[0], [1], [30], [365]])("accepts %i days", (days) => {
    expect(pairingValidity(days)).toBe(days);
  });

  it.each([
    ["below zero", -1],
    ["above a year", 366],
    ["fractional", 1.5],
    ["not a number", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
    ["a numeric string", "30"],
    ["null", null],
    ["undefined", undefined],
  ])("refuses a value that is %s", (_, input) => {
    expect(thrownBy(() => pairingValidity(input))).toMatchObject({
      code: "invalid_request",
    });
  });
});
