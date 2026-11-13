import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanAgentCard } from "@/app/components/agents/plans/plan-node-card/plan-agent-card";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";

import { SOURCES } from "../../page61-plan-fixture";
import {
  agentStep,
  flowContext,
  i18n,
  planOf,
  renderInFlow,
} from "../plan-flow-fixture";

import type { AgentPlanSources, AgentPlanStep } from "@/definition/AgentPlan";

function renderAgent(
  step: AgentPlanStep,
  sources: AgentPlanSources = SOURCES,
): void {
  renderInFlow(
    <PlanAgentCard step={step} result={undefined} hasRun={false} />,
    flowContext({ draft: planOf([step]), sources }),
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

it.each([
  { problem: "missing", hasConfiguration: true },
  { problem: "missing", hasConfiguration: false },
  { problem: "inactive", hasConfiguration: true },
  { problem: "inactive", hasConfiguration: false },
])(
  "warns on the node about an invalid profile: %j",
  ({ problem, hasConfiguration }) => {
    const profile = SOURCES.agents[0];
    if (!profile) throw new Error("Missing fixture profile");
    const configuration = {
      ...copyPlanConfiguration(profile),
      name: "Prepare E2E",
    };
    const agents =
      problem === "missing"
        ? []
        : [
            {
              ...profile,
              availability: {
                isUsable: false,
                reason: "agent_inactive" as const,
                personalChoices: [],
              },
            },
          ];
    renderAgent(
      {
        ...agentStep("node"),
        agentId: profile.id,
        ...(hasConfiguration ? { configuration } : {}),
      },
      { ...SOURCES, agents },
    );
    let expectedName =
      problem === "missing" ? i18n.t("plans.missingAgent") : profile.name;
    if (hasConfiguration) expectedName = "Prepare E2E";
    expect(screen.getByRole("article", { name: expectedName })).toBeDefined();
    expect(screen.getByRole("alert").textContent).toBe(
      i18n.t(
        `plans.validation.${problem === "missing" ? "profileMissing" : "profileInactive"}`,
      ),
    );
  },
);

it("shows no profile warning for a valid agent", () => {
  const profile = SOURCES.agents[0];
  if (!profile) throw new Error("Missing fixture profile");
  renderAgent({ ...agentStep("node"), agentId: profile.id });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("shows no profile warning for an independent model node", () => {
  const profile = SOURCES.agents[0];
  if (!profile) throw new Error("Missing fixture profile");
  const configuration = copyPlanConfiguration(profile);
  renderAgent({
    ...agentStep("node"),
    agentId: "independent",
    configuration: { ...configuration, connectionId: "connection" },
  });
  expect(screen.queryByRole("alert")).toBeNull();
});
