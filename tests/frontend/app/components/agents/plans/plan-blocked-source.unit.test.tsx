import { screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanStatusDetails } from "@/app/components/agents/plans/plan-status-details";

import { renderTranslated } from "./plan-panel-fixture";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";

it("names the recorded failed source of a node that was not run", () => {
  const step: AgentPlanStepResult = {
    id: "successor",
    name: "Fixer",
    status: "waiting",
    isBlocked: true,
    blockedByStepId: "reviewer",
    cancellation: "none",
    output: null,
    error: "plan_dependency_failed",
  };

  renderTranslated(
    <PlanStatusDetails
      step={step}
      blockedByName="Reviewer"
      number={2}
      end={null}
      canLocate={false}
      onLocate={vi.fn()}
    />,
  );

  expect(
    screen.getByText("Not run because Reviewer failed or was cancelled."),
  ).toBeDefined();
});
