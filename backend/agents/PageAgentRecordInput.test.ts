import { describe, expect, it } from "vitest";

import { readArchiveSteps } from "@/backend/agents/PageAgentRecordInput";
import { AgentError } from "@/backend/error/AgentErrors";

function stored(overrides: Record<string, unknown> = {}): unknown {
  return {
    step: { agentId: "agent", id: "step", instruction: "Do it" },
    prepared: { parameters: { markdown: "Context" } },
    model: "gpt",
    reasoningEffort: null,
    ...overrides,
  };
}

describe("readArchiveSteps", () => {
  it("reads the steps of a snapshot", () => {
    expect(
      readArchiveSteps({
        steps: [stored(), stored({ reasoningEffort: "high" })],
      }),
    ).toEqual([
      {
        agentId: "agent",
        stepId: "step",
        model: "gpt",
        reasoningEffort: null,
        input: "Context\n\nDo it",
      },
      {
        agentId: "agent",
        stepId: "step",
        model: "gpt",
        reasoningEffort: "high",
        input: "Context\n\nDo it",
      },
    ]);
  });

  it("refuses a snapshot without a step list", () => {
    expect(() => readArchiveSteps({})).toThrow(AgentError);
    expect(() => readArchiveSteps(null)).toThrow(AgentError);
  });

  it("refuses a reasoning effort that is neither null nor text", () => {
    expect(() =>
      readArchiveSteps({ steps: [stored({ reasoningEffort: 3 })] }),
    ).toThrow(AgentError);
  });

  it("refuses a missing text field", () => {
    expect(() =>
      readArchiveSteps({ steps: [stored({ model: undefined })] }),
    ).toThrow(AgentError);
  });
});
