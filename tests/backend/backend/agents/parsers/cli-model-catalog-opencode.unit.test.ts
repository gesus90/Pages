import { describe, expect, it } from "vitest";

import { readOpenCodeModels } from "@/backend/agents/cli/CliModelCatalog";
import { AgentError } from "@/backend/error/AgentErrors";

/** Prints a model the way `opencode models --verbose` does. */
function verboseEntry(id: string, body: Record<string, unknown>): string {
  // The CLI always prints a model's own ID, so a body is never an empty object.
  return `${id}\n${JSON.stringify({ id, ...body }, null, 2)}`;
}

function expectUnexpected(stdout: string): void {
  let thrown: unknown;
  try {
    readOpenCodeModels(stdout);
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AgentError);
  expect(thrown).toMatchObject({ code: "cli_unexpected_output" });
}

const GLM = {
  id: "z-ai/glm-synthetic",
  name: "GLM Synthetic",
  cost: { input: 3, output: 15 },
  limit: { context: 200_000, output: 8_000 },
  capabilities: { reasoning: true },
  variants: { low: {}, high: {} },
};

describe("readOpenCodeModels", () => {
  it("reads full IDs, prices per token, context and variant efforts", () => {
    const stdout = verboseEntry("openrouter/z-ai/glm-synthetic", GLM);
    expect(readOpenCodeModels(stdout)).toEqual([
      {
        id: "openrouter/z-ai/glm-synthetic",
        name: "GLM Synthetic",
        contextWindow: 200_000,
        promptPrice: "0.000003",
        completionPrice: "0.000015",
        isFree: false,
        reasoning: "levels",
        reasoningEfforts: ["low", "high"],
        defaultReasoningEffort: null,
      },
    ]);
  });

  it("reads several consecutive entries", () => {
    const stdout = [
      verboseEntry("openrouter/a/one", { ...GLM, name: "One" }),
      verboseEntry("openrouter/b/two", { ...GLM, name: "Two" }),
    ].join("\n");
    expect(readOpenCodeModels(stdout).map((model) => model.name)).toEqual([
      "One",
      "Two",
    ]);
  });

  it("marks a model free only when both prices are zero", () => {
    const stdout = [
      verboseEntry("openrouter/free/both", { cost: { input: 0, output: 0 } }),
      verboseEntry("openrouter/free/half", { cost: { input: 0, output: 1 } }),
      verboseEntry("openrouter/free/unpriced", {}),
    ].join("\n");
    expect(readOpenCodeModels(stdout).map((model) => model.isFree)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("ignores prices that are negative or not numbers", () => {
    const stdout = verboseEntry("openrouter/odd/prices", {
      cost: { input: -1, output: "3" },
    });
    const [model] = readOpenCodeModels(stdout);
    expect(model.promptPrice).toBeNull();
    expect(model.completionPrice).toBeNull();
  });
});

describe("readOpenCodeModels reasoning and invalid output", () => {
  it.each([
    [
      "automatic when it reasons without variants",
      { capabilities: { reasoning: true } },
      "automatic",
    ],
    [
      "none when it does not reason",
      { capabilities: { reasoning: false } },
      "none",
    ],
    ["none without capabilities", {}, "none"],
    [
      "none for an unusable variant name",
      { variants: { "Very High": {} } },
      "none",
    ],
  ])("reports reasoning as %s", (_, body, reasoning) => {
    const [model] = readOpenCodeModels(
      verboseEntry("openrouter/vendor/model", body),
    );
    expect(model.reasoning).toBe(reasoning);
  });

  it("falls back to the ID for the name and null for an unusable context", () => {
    const stdout = verboseEntry("openrouter/vendor/model", {
      name: "Bad\u0007Name",
      limit: { context: -1 },
    });
    const [model] = readOpenCodeModels(stdout);
    expect(model.name).toBe("openrouter/vendor/model");
    expect(model.contextWindow).toBeNull();
  });

  it("leaves out deprecated models and IDs that cannot be stored", () => {
    const stdout = [
      verboseEntry("openrouter/old/model", { status: "deprecated" }),
      verboseEntry("openrouter/~alias/latest", {}),
      verboseEntry("openrouter/vendor/current", { status: "active" }),
    ].join("\n");
    expect(readOpenCodeModels(stdout).map((model) => model.id)).toEqual([
      "openrouter/vendor/current",
    ]);
  });

  it.each([
    ["empty output", ""],
    ["only an ID line", "openrouter/vendor/model\n"],
    ["a plain message", "No models found for this provider."],
    [
      "only deprecated models",
      verboseEntry("openrouter/a/b", { status: "deprecated" }),
    ],
    ["an entry with invalid JSON", 'openrouter/a/b\n{\n  "id": \n}'],
    ["an entry with a body that is no JSON", "openrouter/a/b\n{\n  1,\n  2\n}"],
  ])("rejects %s", (_, stdout) => {
    expectUnexpected(stdout);
  });

  it("accepts exactly 5000 models and rejects one more", () => {
    const entries = Array.from({ length: 5001 }, (_, index) =>
      verboseEntry(`openrouter/vendor/model-${index}`, {}),
    );
    expect(readOpenCodeModels(entries.slice(0, 5000).join("\n"))).toHaveLength(
      5000,
    );
    expectUnexpected(entries.join("\n"));
  });
});
