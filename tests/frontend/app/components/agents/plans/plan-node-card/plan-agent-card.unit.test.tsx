import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanAgentCard } from "@/app/components/agents/plans/plan-node-card/plan-agent-card";

import { SOURCES } from "../../page61-plan-fixture";
import {
  agentStep,
  flowContext,
  i18n,
  planOf,
  renderInFlow,
} from "../plan-flow-fixture";

import type { AgentPlanStep } from "@/definition/AgentPlan";

function renderAgent(step: AgentPlanStep): void {
  renderInFlow(
    <PlanAgentCard step={step} result={undefined} hasRun={false} />,
    flowContext({ draft: planOf([step]), sources: SOURCES }),
  );
}

it("names the agent of the step and groups its inputs under that name", () => {
  renderAgent({ ...agentStep("agent"), agentId: "reviewer" });

  expect(screen.getByRole("article", { name: "Reviewer" })).toBeDefined();
  expect(
    screen.getByRole("group", {
      name: i18n.t("plans.inputsOf", { name: "Reviewer" }),
    }),
  ).toBeDefined();
});

it("shows the missing model assignment as the name of a step without a known agent", () => {
  renderAgent({ ...agentStep("agent"), agentId: "deleted" });

  expect(
    screen.getByRole("article", { name: i18n.t("plans.missingAgent") }),
  ).toBeDefined();
});

it("shows no input group for an agent without inputs", () => {
  renderAgent({ ...agentStep("agent"), agentId: "deleted" });

  expect(screen.queryByRole("group")).toBeNull();
});
