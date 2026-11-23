import { describe, expect, it } from "vitest";

import {
  isCatalogModelId,
  readReasoningEfforts,
  reasoningLevels,
  reasoningWithoutLevels,
} from "@/backend/agents/catalog/CatalogParsing";

describe("isCatalogModelId", () => {
  it.each([
    "gpt-5.5",
    "claude-opus-5-5[1m]",
    "openrouter/z-ai/glm-5.2",
    "~anthropic/claude-latest",
    "models/gemini-3.5-flash",
    "vendor/model:free",
    "a",
  ])("accepts %s", (id) => {
    expect(isCatalogModelId(id)).toBe(true);
  });

  it.each([
    ["an empty string", ""],
    ["a leading dash", "-model"],
    ["a space", "bad model"],
    ["a newline", "model\nid"],
    ["a shell character", "model;rm"],
    ["a suffix that is not bracketed", "claude[1m]x"],
    ["an empty bracket suffix", "claude[]"],
    ["an overlong bracket suffix", "claude[12345678901234567]"],
    ["a non-string", 12],
    ["null", null],
  ])("rejects %s", (_, id) => {
    expect(isCatalogModelId(id)).toBe(false);
  });

  it("limits the length to 200 characters", () => {
    expect(isCatalogModelId("a".repeat(200))).toBe(true);
    expect(isCatalogModelId("a".repeat(201))).toBe(false);
  });
});

describe("readReasoningEfforts", () => {
  it("returns a duplicate-free copy in the listed order", () => {
    expect(readReasoningEfforts(["high", "low", "high"])).toEqual([
      "high",
      "low",
    ]);
  });

  it("accepts the largest list of eight and rejects nine", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(readReasoningEfforts(names)).toEqual(names);
    expect(readReasoningEfforts([...names, "i"])).toBeNull();
  });

  it.each([
    ["an empty list", []],
    ["not a list", "low"],
    ["a list with a non-string", ["low", 2]],
    ["a list with an uppercase token", ["Low"]],
    ["a list with a token over 24 characters", ["a".repeat(25)]],
    ["undefined", undefined],
  ])("returns null for %s", (_, input) => {
    expect(readReasoningEfforts(input)).toBeNull();
  });
});

describe("reasoningLevels", () => {
  it("keeps a default that is one of the efforts", () => {
    expect(reasoningLevels(["low", "high"], "high")).toEqual({
      reasoning: "levels",
      reasoningEfforts: ["low", "high"],
      defaultReasoningEffort: "high",
    });
  });

  it.each([["medium"], [null], [7]])(
    "drops the default %j that is not among the efforts",
    (fallback) => {
      expect(
        reasoningLevels(["low", "high"], fallback).defaultReasoningEffort,
      ).toBeNull();
    },
  );
});

describe("reasoningWithoutLevels", () => {
  it.each(["none", "automatic", "unknown"] as const)(
    "names no effort for support %s",
    (support) => {
      expect(reasoningWithoutLevels(support)).toEqual({
        reasoning: support,
        reasoningEfforts: [],
        defaultReasoningEffort: null,
      });
    },
  );
});
