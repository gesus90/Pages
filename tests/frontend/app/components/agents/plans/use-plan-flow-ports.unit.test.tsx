import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  planPortLayout,
  usePlanFlowPorts,
} from "@/app/components/agents/plans/use-plan-flow-ports";

import { runStep } from "../page72-run-fixture";
import { eventEdge, reviewCyclePlan } from "./plan-branching-fixture";
import { GROUP_SOURCES } from "./plan-group-fixture";

import type { AgentPlanNode } from "@/definition/AgentPlan";

const measure = vi.hoisted(() => vi.fn<(id: string) => void>());

vi.mock("@xyflow/react", () => ({ useUpdateNodeInternals: () => measure }));

function node(id: string): AgentPlanNode {
  const found = reviewCyclePlan().nodes.find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing node ${id}`);
  return found;
}

it("changes its layout text when a row or a note appears on a card", () => {
  const plan = reviewCyclePlan();
  const plain = {
    ...plan,
    edges: plan.edges.filter((edge) => edge.toPort !== "event-in"),
  };
  const check = node("check");

  const base = planPortLayout(plain, check, undefined);
  expect(planPortLayout(plan, check, undefined)).not.toBe(base);
  expect(
    planPortLayout(plain, check, runStep("check", { activation: 2 })),
  ).not.toBe(base);
  expect(
    planPortLayout(plain, check, runStep("check", { passed: true })),
  ).not.toBe(base);
  expect(
    planPortLayout(
      plain,
      check,
      runStep("check", {
        trigger: {
          kind: "event",
          promptLength: 1,
          sources: [{ stepId: "fix", activation: 1 }],
        },
      }),
    ),
  ).not.toBe(base);
  expect(
    planPortLayout(
      plain,
      node("decision"),
      runStep("decision", { activation: 1 }),
    ),
  ).not.toBe(
    planPortLayout(
      plain,
      node("decision"),
      runStep("decision", {
        condition: { sourceStepId: "check", sourceActivation: 1, value: true },
      }),
    ),
  );
  // The same card twice has the same text.
  expect(planPortLayout(plain, check, undefined)).toBe(base);
  expect(
    planPortLayout(
      { ...plan, edges: [...plain.edges, eventEdge("fix", "check")] },
      check,
      undefined,
    ),
  ).toBe(planPortLayout(plan, check, undefined));
});

it("measures the ports again whenever the layout text changes", () => {
  function Card(props: { readonly layout: string }): null {
    usePlanFlowPorts(node("check"), GROUP_SOURCES, props.layout);
    return null;
  }
  const view = render(<Card layout="a" />);
  expect(measure).toHaveBeenCalledTimes(1);
  expect(measure).toHaveBeenLastCalledWith("check");

  view.rerender(<Card layout="a" />);
  expect(measure).toHaveBeenCalledTimes(1);
  view.rerender(<Card layout="b" />);
  expect(measure).toHaveBeenCalledTimes(2);
});
