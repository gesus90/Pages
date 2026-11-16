import { expect, it } from "vitest";

import { planRunStructure } from "@/backend/service/agents/AgentPlanRunStructure";

import {
  agent,
  boundary,
  edge,
  loopOf,
  planOf,
  script,
} from "../../../definition/plan-fixtures";
import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";

it("projects ordered snapshot flow without exposing agent instructions", () => {
  const plan = planOf(
    [
      boundary("start", "start"),
      agent("a"),
      script("script"),
      boundary("end", "end"),
    ],
    [edge("start", "a"), edge("a", "script"), edge("script", "end")],
  );
  const snapshot = partial<AgentPlanSnapshot>({
    plan,
    steps: [{ step: agent("a"), name: "Worker" }],
  });
  expect(planRunStructure(snapshot)).toEqual([
    [{ id: "start", kind: "start", number: 1, name: null, isStep: false }],
    [{ id: "a", kind: "agent", number: 2, name: "Worker", isStep: true }],
    [{ id: "script", kind: "script", number: 3, name: "script", isStep: true }],
    [{ id: "end", kind: "end", number: 4, name: null, isStep: false }],
  ]);
});

it("takes a remote agent name from the pinned snapshot and excludes unreachable nodes", () => {
  const plan = planOf(
    [boundary("start", "start"), agent("a"), agent("unreachable")],
    [edge("start", "a")],
  );
  const snapshot = partial<AgentPlanSnapshot>({
    plan,
    steps: [],
    remoteSteps: [
      { step: { ...agent("a"), configuration: { name: "Remote" } } },
    ],
  });
  expect(planRunStructure(snapshot)).toMatchObject([
    [{ id: "start" }],
    [{ id: "a", name: "Remote" }],
  ]);
});

it("counts a loop once and describes its iteration separately", () => {
  const loop = loopOf("loop", [agent("inner")]);
  const plan = planOf(
    [boundary("start", "start"), loop, boundary("end", "end")],
    [edge("start", "loop"), edge("loop", "end")],
  );
  const snapshot = partial<AgentPlanSnapshot>({
    plan,
    steps: [{ step: agent("inner"), name: "Inner" }],
  });
  const stages = planRunStructure(snapshot);
  expect(stages[1][0]).toMatchObject({
    id: "loop",
    kind: "loop",
    isStep: true,
  });
  expect(Array.isArray(stages[1][0].iteration)).toBe(true);
});
