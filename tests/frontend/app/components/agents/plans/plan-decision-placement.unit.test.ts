import { expect, it, vi } from "vitest";

import { placePlanDecisionDrop } from "@/app/components/agents/plans/plan-decision-placement";
import { planOf } from "../../../../definition/plan-fixtures";

import type { AgentPlanInput } from "@/definition/AgentPlan";

it("moves a decision on the outer grid and ignores unknown nodes", () => {
  const draft = planOf([{ id: "decision", type: "decision", x: 0, y: 0 }]);
  let updated = draft;
  const setDraft = vi.fn((change: React.SetStateAction<AgentPlanInput>) => {
    updated = typeof change === "function" ? change(updated) : change;
  });
  const setNotice = vi.fn();
  const context = {
    draft,
    setDraft,
    setNotice,
    sources: { agents: [], tasks: [] },
  };
  const drop = { pointer: { x: 1000, y: 1000 }, position: { x: 120, y: 150 } };
  expect(placePlanDecisionDrop(context, "unknown", drop)).toBe(false);
  expect(setDraft).not.toHaveBeenCalled();
  expect(placePlanDecisionDrop(context, "decision", drop)).toBe(true);
  expect(updated.nodes).toEqual([
    { id: "decision", type: "decision", x: 120, y: 150 },
  ]);
  expect(setNotice).toHaveBeenCalledWith(null);
});
