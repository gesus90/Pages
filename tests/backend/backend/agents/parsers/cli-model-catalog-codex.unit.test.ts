import { describe, expect, it } from "vitest";

import { readCodexModels } from "@/backend/agents/cli/CliModelCatalog";
import { AgentError } from "@/backend/error/AgentErrors";

function listing(models: readonly unknown[]): string {
  return JSON.stringify({ models });
}

function expectUnexpected(stdout: string): void {
  let thrown: unknown;
  try {
    readCodexModels(stdout);
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AgentError);
  expect(thrown).toMatchObject({ code: "cli_unexpected_output" });
}

const PRIMARY = {
  slug: "gpt-synthetic",
  display_name: "GPT Synthetic",
  visibility: "list",
  priority: 2,
  context_window: 272_000,
  default_reasoning_level: "medium",
  supported_reasoning_levels: [
    { effort: "low", description: "Fast" },
    { effort: "medium", description: "Balanced" },
    { effort: "high", description: "Deep" },
  ],
};

describe("readCodexModels", () => {
  it("lists visible models with context window and reasoning levels", () => {
    expect(readCodexModels(listing([PRIMARY]))).toEqual([
      {
        id: "gpt-synthetic",
        name: "GPT Synthetic",
        contextWindow: 272_000,
        promptPrice: null,
        completionPrice: null,
        isFree: false,
        reasoning: "levels",
        reasoningEfforts: ["low", "medium", "high"],
        defaultReasoningEffort: "medium",
      },
    ]);
  });

  it("keeps only models marked for the picker, in priority order", () => {
    const models = readCodexModels(
      listing([
        { ...PRIMARY, slug: "second", priority: 5 },
        { slug: "internal", visibility: "hide", priority: 0 },
        { ...PRIMARY, slug: "first", priority: 1 },
        { ...PRIMARY, slug: "unranked", priority: undefined },
      ]),
    );
    expect(models.map((model) => model.id)).toEqual([
      "first",
      "second",
      "unranked",
    ]);
  });

  it("keeps the listed order between equal priorities", () => {
    const models = readCodexModels(
      listing([
        { ...PRIMARY, slug: "b", priority: 1 },
        { ...PRIMARY, slug: "a", priority: 1 },
      ]),
    );
    expect(models.map((model) => model.id)).toEqual(["b", "a"]);
  });
});

describe("readCodexModels reasoning", () => {
  it("reports no levels for a model without reasoning data", () => {
    const [model] = readCodexModels(
      listing([{ slug: "plain", visibility: "list" }]),
    );
    expect(model).toMatchObject({
      name: "plain",
      contextWindow: null,
      reasoning: "none",
      reasoningEfforts: [],
      defaultReasoningEffort: null,
    });
  });

  it("drops a default level that the model does not list", () => {
    const [model] = readCodexModels(
      listing([{ ...PRIMARY, default_reasoning_level: "xhigh" }]),
    );
    expect(model.reasoningEfforts).toEqual(["low", "medium", "high"]);
    expect(model.defaultReasoningEffort).toBeNull();
  });

  it("removes duplicate levels", () => {
    const [model] = readCodexModels(
      listing([
        {
          ...PRIMARY,
          supported_reasoning_levels: [
            { effort: "low" },
            { effort: "low" },
            { effort: "high" },
          ],
        },
      ]),
    );
    expect(model.reasoningEfforts).toEqual(["low", "high"]);
  });

  it("treats a list with an unusable effort token as having no levels", () => {
    const [model] = readCodexModels(
      listing([
        {
          ...PRIMARY,
          supported_reasoning_levels: [
            { effort: "low" },
            { effort: "Very High!" },
          ],
        },
      ]),
    );
    expect(model.reasoning).toBe("none");
  });
});

describe("readCodexModels invalid fields and limits", () => {
  it.each([
    ["a control character", "Bad\nName"],
    ["over 200 characters", "x".repeat(201)],
    ["an empty string", ""],
    ["a non-string", 7],
  ])("falls back to the slug when the display name has %s", (_, name) => {
    const [model] = readCodexModels(
      listing([{ ...PRIMARY, display_name: name }]),
    );
    expect(model.name).toBe("gpt-synthetic");
  });

  it.each([
    ["zero", 0],
    ["negative", -5],
    ["fractional", 1000.5],
    ["a string", "272000"],
  ])("ignores a context window that is %s", (_, window) => {
    const [model] = readCodexModels(
      listing([{ ...PRIMARY, context_window: window }]),
    );
    expect(model.contextWindow).toBeNull();
  });

  it.each([
    ["an empty output", ""],
    ["truncated JSON", '{"models":[{"slug":"gpt'],
    ["a log line", "codex 0.50.0 starting"],
    ["a root array", "[]"],
    ["models that are not an array", '{"models":{}}'],
    ["no model at all", listing([])],
    ["only hidden models", listing([{ slug: "x", visibility: "hide" }])],
    ["entries that are not objects", listing([null, 3, "x"])],
    ["a slug with a space", listing([{ ...PRIMARY, slug: "bad slug" }])],
    ["a slug that is missing", listing([{ visibility: "list" }])],
    [
      "more than 1000 entries",
      listing(Array.from({ length: 1001 }, () => PRIMARY)),
    ],
  ])("rejects %s", (_, stdout) => {
    expectUnexpected(stdout);
  });

  it("accepts exactly 1000 entries", () => {
    const entries = Array.from({ length: 1000 }, (_, index) => ({
      ...PRIMARY,
      slug: `model-${index}`,
    }));
    expect(readCodexModels(listing(entries))).toHaveLength(1000);
  });
});
