import { describe, expect, it } from "vitest";

import { readPlanConfiguration } from "@/backend/agents/AgentPlanConfigurationInput";
import { AgentError } from "@/backend/error/AgentErrors";

const ROUTE = {
  connectionId: "7f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f",
  workspaceId: "8f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f",
  catalogRevision: "1",
};

function entry(
  overrides: Record<string, unknown> = {},
  template: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "Node",
    revision: 1,
    modelProfileId: "profile",
    model: "gpt",
    provider: null,
    reasoningEffort: null,
    template: {
      markdown: "Body",
      parameters: [],
      directoryParameter: null,
      ...template,
    },
    ...overrides,
  };
}

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof AgentError ? error.code : undefined;
  }
  return undefined;
}

describe("readPlanConfiguration", () => {
  it("reads a minimal copy without optional fields", () => {
    const result = readPlanConfiguration(entry());
    expect(result).toEqual({
      name: "Node",
      revision: 1,
      modelProfileId: "profile",
      model: "gpt",
      provider: null,
      reasoningEffort: null,
      template: { markdown: "Body", parameters: [], directoryParameter: null },
    });
    expect("runnerRoute" in result).toBe(false);
    expect("connectionId" in result).toBe(false);
  });

  it("reads route, connection, provider, effort and run options", () => {
    const run = {
      access: "read_only",
      shell: false,
      web: false,
      timeoutMinutes: 5,
    };
    const result = readPlanConfiguration(
      entry(
        {
          runnerRoute: ROUTE,
          connectionId: " c ",
          provider: "codex_cli",
          reasoningEffort: "high",
          model: "",
          modelProfileId: "",
        },
        { run },
      ),
    );
    expect(result.runnerRoute).toEqual(ROUTE);
    expect(result.connectionId).toBe(" c ");
    expect(result.provider).toBe("codex_cli");
    expect(result.reasoningEffort).toBe("high");
    expect(result.model).toBe("");
    expect(result.template.run).toEqual(run);
  });

  it("keeps a node of a retired provider without a provider", () => {
    expect(
      readPlanConfiguration(entry({ provider: "zai" })).provider,
    ).toBeNull();
  });

  it("keeps removed run-note tokens for diagnostics", () => {
    expect(
      readPlanConfiguration(entry({}, { markdown: "{{@run.notes}}" })).template
        .markdown,
    ).toBe("{{@run.notes}}");
  });

  it("rejects other parameter issues", () => {
    expect(
      codeOf(() =>
        readPlanConfiguration(entry({}, { markdown: "{{missing}}" })),
      ),
    ).toBe("parameter_invalid");
  });

  it("rejects a malformed envelope", () => {
    const invalid = [
      { revision: "1" },
      { revision: 1.5 },
      { revision: 0 },
      { reasoningEffort: 1 },
      { reasoningEffort: "x".repeat(101) },
      { provider: "unknown" },
      { provider: undefined },
      { name: 1 },
      { name: "x".repeat(201) },
      { model: " " },
      { connectionId: "" },
      { modelProfileId: 1 },
    ];
    for (const overrides of invalid)
      expect(codeOf(() => readPlanConfiguration(entry(overrides)))).toBe(
        "configuration_invalid",
      );
  });

  it("rejects a malformed route", () => {
    expect(() =>
      readPlanConfiguration(entry({ runnerRoute: { connectionId: "x" } })),
    ).toThrow();
  });
});
