import { expect, it } from "vitest";

import { activeStages } from "@/backend/service/agents/AgentPlanActiveRuns";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlan } from "@/definition/AgentPlan";

it("numbers parallel work from the executed flow and omits its boundaries and decisions", () => {
  const plan = partial<AgentPlan>({
    nodes: [
      { id: "start", type: "start" },
      { id: "a", type: "agent" },
      { id: "b", type: "script" },
      { id: "choice", type: "decision" },
      { id: "end", type: "end" },
      { id: "unreachable", type: "agent" },
    ],
    edges: [
      { from: "start", to: "a" },
      { from: "start", to: "b" },
      { from: "a", to: "choice" },
      { from: "b", to: "choice" },
      { from: "choice", to: "end" },
    ],
  });
  expect(activeStages(plan)).toEqual([
    [
      { id: "a", number: 2, isLoop: false },
      { id: "b", number: 3, isLoop: false },
    ],
  ]);
});
