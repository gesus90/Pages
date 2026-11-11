import { describe, expect, it } from "vitest";

import { isRootData } from "@/app/lib/root-data";

const ROOT = {
  language: "de",
  theme: "dark",
  designTheme: { id: "default", stylesheet: null },
  draftOwnerId: "user-1",
};

describe("isRootData", () => {
  it("accepts a complete answer", () => {
    expect(isRootData(ROOT)).toBe(true);
  });

  it("accepts a signed-out document and a design theme with a stylesheet", () => {
    expect(
      isRootData({
        ...ROOT,
        language: "en",
        theme: "system",
        designTheme: { id: "custom", stylesheet: "body{}" },
        draftOwnerId: null,
      }),
    ).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "root"],
    ["a missing language", { ...ROOT, language: undefined }],
    ["an unsupported language", { ...ROOT, language: "fr" }],
    ["a missing theme", { ...ROOT, theme: undefined }],
    ["an unknown theme", { ...ROOT, theme: "blue" }],
    ["a missing design theme", { ...ROOT, designTheme: undefined }],
    ["a null design theme", { ...ROOT, designTheme: null }],
    [
      "a design theme without id",
      { ...ROOT, designTheme: { stylesheet: null } },
    ],
    [
      "a design theme with a numeric id",
      { ...ROOT, designTheme: { id: 1, stylesheet: null } },
    ],
    [
      "a design theme without stylesheet",
      { ...ROOT, designTheme: { id: "d" } },
    ],
    [
      "a design theme with a numeric stylesheet",
      { ...ROOT, designTheme: { id: "d", stylesheet: 3 } },
    ],
    ["a missing draft owner", { ...ROOT, draftOwnerId: undefined }],
    ["a numeric draft owner", { ...ROOT, draftOwnerId: 5 }],
  ])("refuses %s", (label, value) => {
    expect(isRootData(value)).toBe(false);
  });

  it("refuses an answer that lacks the draft owner key altogether", () => {
    const incomplete: Record<string, unknown> = { ...ROOT };
    delete incomplete.draftOwnerId;

    expect(isRootData(incomplete)).toBe(false);
  });
});
