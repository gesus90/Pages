import { describe, expect, it, vi } from "vitest";

import {
  readClaudeModels,
  readCodexModels,
  readOpenCodeModels,
} from "@/backend/agents/cli/CliModelCatalog";

const logging = vi.hoisted(() => ({ logCaughtError: vi.fn() }));

vi.mock("@/backend/logging/Logger", () => logging);

function codexList(models: readonly unknown[]): string {
  return JSON.stringify({ models });
}

describe("readCodexModels", () => {
  it("lists visible models by priority with reasoning levels", () => {
    const models = readCodexModels(
      codexList([
        {
          slug: "late",
          visibility: "list",
          display_name: "Late",
          priority: 5,
        },
        { slug: "hidden", visibility: "hide", priority: 0 },
        {
          slug: "gpt-5",
          visibility: "list",
          display_name: "GPT 5",
          priority: 1,
          context_window: 1000,
          effective_context_window_percent: 95,
          default_reasoning_level: "medium",
          supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }],
        },
        { slug: "unranked", visibility: "list", priority: Number.NaN },
        { slug: "unranked-two", visibility: "list" },
      ]),
    );

    expect(models.map((model) => model.id)).toEqual([
      "gpt-5",
      "late",
      "unranked",
      "unranked-two",
    ]);
    expect(models[0]).toMatchObject({
      name: "GPT 5",
      contextWindow: 950,
      reasoning: "levels",
      reasoningEfforts: ["low", "medium"],
      defaultReasoningEffort: "medium",
    });
    expect(models[1]).toMatchObject({
      reasoning: "none",
      reasoningEfforts: [],
      contextWindow: null,
    });
    expect(models[2].name).toBe("unranked");
  });

  it("derives the context window from the listed window", () => {
    const window = (listed: unknown, share: unknown): number | null =>
      readCodexModels(
        codexList([
          {
            slug: "m",
            visibility: "list",
            context_window: listed,
            effective_context_window_percent: share,
          },
        ]),
      )[0].contextWindow;

    expect(window(0, 50)).toBeNull();
    expect(window(1000, undefined)).toBe(1000);
    expect(window(1000, 101)).toBe(1000);
    expect(window(1, 50)).toBeNull();
  });

  it("falls back to the ID for an unusable display name", () => {
    const [model] = readCodexModels(
      codexList([
        { slug: "m", visibility: "list", display_name: "bad\u0007name" },
      ]),
    );

    expect(model.name).toBe("m");
  });

  it("rejects invalid output", () => {
    expect(() => readCodexModels("not json")).toThrow();
    expect(logging.logCaughtError).toHaveBeenCalledWith(
      "CliModelCatalog",
      expect.any(SyntaxError),
    );
    expect(() => readCodexModels("{}")).toThrow();
    expect(() =>
      readCodexModels(codexList(new Array(1001).fill({}))),
    ).toThrow();
    expect(() =>
      readCodexModels(codexList([{ visibility: "hide" }])),
    ).toThrow();
    expect(() =>
      readCodexModels(codexList([{ slug: "bad id", visibility: "list" }])),
    ).toThrow();
  });
});

function claudeOutput(models: readonly unknown[]): string {
  return [
    JSON.stringify({ type: "system" }),
    JSON.stringify({
      type: "control_response",
      response: { request_id: "other", subtype: "success" },
    }),
    JSON.stringify({
      type: "control_response",
      response: {
        request_id: "pages-model-catalog",
        subtype: "success",
        response: { models },
      },
    }),
  ].join("\n");
}

describe("readClaudeModels", () => {
  it("merges rows of one model and keeps their aliases", () => {
    const models = readClaudeModels(
      claudeOutput([
        {
          value: "default",
          resolvedModel: "claude-sonnet-4-5",
          displayName: "Default",
          supportedEffortLevels: ["low", "high"],
          supportsEffort: true,
        },
        {
          value: "sonnet",
          resolvedModel: "claude-sonnet-4-5",
          displayName: "Sonnet",
          supportedEffortLevels: ["low", "high"],
        },
        {
          value: "sonnet",
          resolvedModel: "claude-sonnet-4-5",
          displayName: "Sonnet again",
          supportedEffortLevels: ["low", "high"],
        },
        { value: "gone", resolvedModel: "claude-gone-1", disabled: true },
      ]),
    );

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: "claude-sonnet-4-5",
      aliases: ["sonnet"],
      reasoning: "levels",
      reasoningEfforts: ["low", "high"],
      defaultReasoningEffort: null,
    });
  });

  it("states the reasoning support of rows without effort levels", () => {
    const models = readClaudeModels(
      claudeOutput([
        { value: "haiku", displayName: 5, supportsEffort: false },
        { value: "claude-other-1" },
        { value: "claude-third-1", supportsEffort: true },
        { value: "default" },
        { value: "claude-same-1" },
      ]),
    );

    expect(models.map((model) => [model.id, model.reasoning])).toEqual([
      ["haiku", "none"],
      ["claude-other-1", "unknown"],
      ["claude-third-1", "unknown"],
      ["default", "unknown"],
      ["claude-same-1", "unknown"],
    ]);
    expect(models[0]).not.toHaveProperty("aliases");
  });

  it("rejects invalid output", () => {
    expect(() => readClaudeModels("{broken")).toThrow();
    expect(logging.logCaughtError).toHaveBeenCalledWith(
      "CliModelCatalog",
      expect.any(SyntaxError),
    );
    expect(() => readClaudeModels(JSON.stringify([1]))).toThrow();
    expect(() => readClaudeModels(JSON.stringify({ type: "x" }))).toThrow();
    const respond = (response: unknown): string =>
      JSON.stringify({
        type: "control_response",
        response: {
          request_id: "pages-model-catalog",
          ...(response as object),
        },
      });
    expect(() => readClaudeModels(respond({ subtype: "error" }))).toThrow();
    expect(() => readClaudeModels(respond({ subtype: "success" }))).toThrow();
    expect(() =>
      readClaudeModels(
        claudeOutput(new Array(1001).fill({ value: "claude-x-1" })),
      ),
    ).toThrow();
    expect(() => readClaudeModels(claudeOutput([]))).toThrow();
    expect(() =>
      readClaudeModels(claudeOutput([{ value: "bad id" }])),
    ).toThrow();
  });
});

function openCodeEntry(id: string, entry: unknown): string {
  return `${id}\n${JSON.stringify(entry, null, 2)}`;
}

describe("readOpenCodeModels", () => {
  it("reads prices, limits, variants and capabilities", () => {
    const stdout = [
      openCodeEntry("openrouter/vendor/free", {
        name: "Free",
        cost: { input: 0, output: 0 },
        limit: { context: 8000 },
        variants: { low: {}, high: {} },
        capabilities: {
          reasoning: true,
          toolcall: true,
          input: { text: true, image: true, audio: false },
          output: { text: true },
        },
      }),
      openCodeEntry("openrouter/vendor/paid", {
        name: "bad\u0007",
        cost: { input: 3, output: 15.5 },
        limit: { context: 0 },
        capabilities: {
          reasoning: true,
          toolcall: false,
          input: { text: true, image: false },
        },
      }),
      openCodeEntry("openrouter/vendor/plain", {
        cost: { input: -1, output: Number.MAX_SAFE_INTEGER },
        capabilities: { input: [], output: {} },
      }),
    ].join("\n");

    const models = readOpenCodeModels(stdout);

    expect(models).toHaveLength(3);
    expect(models[0]).toMatchObject({
      id: "openrouter/vendor/free",
      name: "Free",
      contextWindow: 8000,
      promptPrice: "0",
      isFree: true,
      reasoning: "levels",
      supportsImages: true,
      isToolCapable: true,
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
    });
    expect(models[1]).toMatchObject({
      name: "openrouter/vendor/paid",
      contextWindow: null,
      promptPrice: "0.000003",
      completionPrice: "0.0000155",
      isFree: false,
      reasoning: "automatic",
      supportsImages: false,
      isToolCapable: false,
    });
    expect(models[1]).not.toHaveProperty("outputModalities");
    expect(models[2]).toMatchObject({ promptPrice: null, reasoning: "none" });
    expect(models[2]).not.toHaveProperty("supportsImages");
    expect(models[2]).not.toHaveProperty("inputModalities");
  });

  it("leaves out retired, unstorable and filtered models", () => {
    const stdout = [
      openCodeEntry("openrouter/~alias", { name: "Alias" }),
      openCodeEntry("openrouter/inactive", { status: "deprecated" }),
      openCodeEntry("openrouter/kept", { name: "Kept" }),
    ].join("\n");

    expect(readOpenCodeModels(stdout).map((model) => model.id)).toEqual([
      "openrouter/kept",
    ]);
  });

  it("leaves out a model of a retired provider", () => {
    const stdout = [
      openCodeEntry("zai/model", { name: "Old" }),
      openCodeEntry("new/model", { name: "New" }),
    ].join("\n");

    expect(readOpenCodeModels(stdout).map((model) => model.id)).toEqual([
      "new/model",
    ]);
  });

  it("rejects invalid output", () => {
    expect(() => readOpenCodeModels("nothing here")).toThrow();
    expect(() => readOpenCodeModels("a/b\n{\n  not json\n}")).toThrow();
    expect(logging.logCaughtError).toHaveBeenCalledWith(
      "CliModelCatalog",
      expect.any(SyntaxError),
    );
  });

  it("rejects a list with too many models", () => {
    const entry = (index: number): string =>
      openCodeEntry(`p/m${index}`, { name: "x" });
    const stdout = Array.from({ length: 5001 }, (_, index) =>
      entry(index),
    ).join("\n");

    expect(() => readOpenCodeModels(stdout)).toThrow();
  });
});
