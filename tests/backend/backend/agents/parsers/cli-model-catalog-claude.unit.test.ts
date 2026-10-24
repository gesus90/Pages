import { describe, expect, it } from "vitest";

import { readClaudeModels } from "@/backend/agents/cli/CliModelCatalog";
import { AgentError } from "@/backend/error/AgentErrors";

import { jsonLines } from "./cli-output-lines";

function initializeResponse(models: unknown, subtype = "success"): string {
  return jsonLines([
    { type: "system", subtype: "init", session_id: "synthetic" },
    {
      type: "control_response",
      response: {
        subtype,
        request_id: "pages-model-catalog",
        response: { models },
      },
    },
  ]);
}

function expectUnexpected(stdout: string): void {
  let thrown: unknown;
  try {
    readClaudeModels(stdout);
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AgentError);
  expect(thrown).toMatchObject({ code: "cli_unexpected_output" });
}

const OPUS = {
  value: "opus",
  resolvedModel: "claude-opus-synthetic",
  displayName: "Opus Synthetic",
  supportsEffort: true,
  supportedEffortLevels: ["low", "medium", "high"],
};

describe("readClaudeModels", () => {
  it("reads the picker rows of the initialize response", () => {
    expect(readClaudeModels(initializeResponse([OPUS]))).toEqual([
      {
        id: "claude-opus-synthetic",
        name: "Opus Synthetic",
        contextWindow: null,
        promptPrice: null,
        completionPrice: null,
        isFree: false,
        reasoning: "levels",
        reasoningEfforts: ["low", "medium", "high"],
        defaultReasoningEffort: null,
        aliases: ["opus"],
      },
    ]);
  });

  it("falls back to the picker value when no canonical ID is resolved", () => {
    const [model] = readClaudeModels(
      initializeResponse([{ value: "claude-haiku-synthetic" }]),
    );
    expect(model.id).toBe("claude-haiku-synthetic");
    expect(model.name).toBe("claude-haiku-synthetic");
  });

  it("keeps a 1M-context variant selectable next to its base model", () => {
    const models = readClaudeModels(
      initializeResponse([
        OPUS,
        { ...OPUS, resolvedModel: "claude-opus-synthetic[1m]" },
      ]),
    );
    expect(models.map((model) => model.id)).toEqual([
      "claude-opus-synthetic",
      "claude-opus-synthetic[1m]",
    ]);
  });

  it("merges rows that resolve to the same model, the later name winning", () => {
    const models = readClaudeModels(
      initializeResponse([
        { ...OPUS, value: "default", displayName: "Default (recommended)" },
        { value: "haiku", resolvedModel: "claude-haiku-synthetic" },
        { ...OPUS, displayName: "Opus Synthetic" },
      ]),
    );
    expect(models.map((model) => [model.id, model.name])).toEqual([
      ["claude-opus-synthetic", "Opus Synthetic"],
      ["claude-haiku-synthetic", "claude-haiku-synthetic"],
    ]);
  });

  it("skips rows the CLI shows but does not let anyone select", () => {
    const models = readClaudeModels(
      initializeResponse([
        { ...OPUS, resolvedModel: "claude-locked", disabled: true },
        OPUS,
      ]),
    );
    expect(models.map((model) => model.id)).toEqual(["claude-opus-synthetic"]);
  });
});

describe("readClaudeModels reasoning and invalid responses", () => {
  it.each([
    [
      "false",
      { supportsEffort: false, supportedEffortLevels: ["low"] },
      "none",
    ],
    [
      "absent with no levels",
      { supportsEffort: undefined, supportedEffortLevels: undefined },
      "unknown",
    ],
    [
      "true with an unusable list",
      { supportsEffort: true, supportedEffortLevels: [] },
      "unknown",
    ],
  ])("reports effort support %s as %s", (_, fields, reasoning) => {
    const [model] = readClaudeModels(
      initializeResponse([{ ...OPUS, ...fields }]),
    );
    expect(model.reasoning).toBe(reasoning);
    expect(model.reasoningEfforts).toEqual([]);
  });

  it("ignores unrelated lines such as other control responses", () => {
    const stdout = `${jsonLines([
      {
        type: "control_response",
        response: { subtype: "success", request_id: "other", response: {} },
      },
    ])}${initializeResponse([OPUS])}`;
    expect(readClaudeModels(stdout)).toHaveLength(1);
  });

  it("tolerates surrounding blank lines", () => {
    expect(
      readClaudeModels(`\n\n${initializeResponse([OPUS])}\n\n`),
    ).toHaveLength(1);
  });

  it.each([
    ["empty output", ""],
    [
      "a non-JSON line",
      `Warning: update available\n${initializeResponse([OPUS])}`,
    ],
    ["an error response", initializeResponse([OPUS], "error")],
    ["no catalog response at all", jsonLines([{ type: "system" }])],
    ["models that are not an array", initializeResponse("opus")],
    ["no model at all", initializeResponse([])],
    ["only disabled models", initializeResponse([{ ...OPUS, disabled: true }])],
    ["an ID that cannot be stored", initializeResponse([{ value: "bad id!" }])],
    ["a row without any ID", initializeResponse([{ displayName: "Nameless" }])],
    [
      "more than 1000 rows",
      initializeResponse(Array.from({ length: 1001 }, () => OPUS)),
    ],
  ])("rejects %s", (_, stdout) => {
    expectUnexpected(stdout);
  });
});
