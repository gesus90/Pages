import { expect, it } from "vitest";

import {
  hasLevelPicker,
  modelsOfSameTarget,
  reasoningChoices,
} from "@/definition/AgentReasoningChoice";

it("limits comparisons to the same CLI connection or runner target", () => {
  const chosen = {
    provider: "codex_cli",
    connectionId: "one",
    reasoningEfforts: ["high"],
  };
  const other = { ...chosen, connectionId: "two" };
  expect(hasLevelPicker("claude_code")).toBe(true);
  expect(hasLevelPicker("openrouter")).toBe(false);
  expect(modelsOfSameTarget([chosen, other], chosen)).toEqual([chosen]);
  expect(modelsOfSameTarget([chosen], undefined)).toEqual([]);
  const runner = {
    provider: "codex_cli",
    runnerRoute: { workspaceId: "w", tool: "codex" },
  };
  expect(
    modelsOfSameTarget(
      [runner, { ...runner, runnerRoute: { workspaceId: "w", tool: "other" } }],
      runner,
    ),
  ).toEqual([runner]);
});

it("sorts the union of levels and marks only the selected model's support", () => {
  const selected = { reasoningEfforts: ["high", "unusual"] };
  expect(
    reasoningChoices(selected, [
      { reasoningEfforts: ["medium", "high", "low"] },
    ]),
  ).toEqual([
    { effort: "low", isSupported: false },
    { effort: "medium", isSupported: false },
    { effort: "high", isSupported: true },
    { effort: "unusual", isSupported: true },
  ]);
  expect(reasoningChoices(undefined, [])).toEqual([]);
});
