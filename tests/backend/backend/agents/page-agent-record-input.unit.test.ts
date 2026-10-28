import { expect, it } from "vitest";

import { readArchiveSteps } from "@/backend/agents/PageAgentRecordInput";

function storedStep(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    step: { agentId: "agent-1", id: "step-1", instruction: "Do it" },
    model: "gpt-5",
    reasoningEffort: "high",
    prepared: { parameters: { markdown: "# Ticket" } },
    ...overrides,
  };
}

it("reads the archive fields of each frozen step", () => {
  const snapshot = {
    steps: [storedStep(), storedStep({ reasoningEffort: null })],
  };

  expect(readArchiveSteps(snapshot)).toEqual([
    {
      agentId: "agent-1",
      stepId: "step-1",
      model: "gpt-5",
      reasoningEffort: "high",
      input: "# Ticket\n\nDo it",
    },
    {
      agentId: "agent-1",
      stepId: "step-1",
      model: "gpt-5",
      reasoningEffort: null,
      input: "# Ticket\n\nDo it",
    },
  ]);
});

it.each([
  ["a snapshot without steps", {}],
  [
    "a numeric reasoning effort",
    { steps: [storedStep({ reasoningEffort: 2 })] },
  ],
  ["a missing model", { steps: [storedStep({ model: undefined })] }],
  ["a missing prepared markdown", { steps: [storedStep({ prepared: null })] }],
])("refuses %s", (_, snapshot) => {
  expect(() => readArchiveSteps(snapshot)).toThrow(
    expect.objectContaining({ code: "plan_invalid" }),
  );
});
