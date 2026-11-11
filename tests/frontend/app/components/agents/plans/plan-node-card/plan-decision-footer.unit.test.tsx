import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanDecisionFooter } from "@/app/components/agents/plans/plan-node-card/plan-decision-footer";

import { runStep, syntheticRun } from "../../page72-run-fixture";
import { DECISION } from "../plan-branching-fixture";
import { flowContext, i18n, planOf, renderInFlow } from "../plan-flow-fixture";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";

function renderFooter(
  result: AgentPlanStepResult | undefined,
  runSteps: readonly AgentPlanStepResult[] = [],
): HTMLElement {
  renderInFlow(
    <PlanDecisionFooter result={result} />,
    flowContext({
      draft: planOf([{ ...DECISION, name: "Quality gate" }]),
      run: { ...syntheticRun(), steps: runSteps },
    }),
  );
  return screen.getByRole("contentinfo");
}

it("says only that one output is activated while no run result exists", () => {
  const footer = renderFooter(undefined);

  expect(footer.textContent).toBe(i18n.t("plans.decision.footer"));
  expect(footer.querySelector("[data-plan-evaluated]")).toBeNull();
  expect(footer.querySelector("[data-plan-verdict]")).toBeNull();
});

it("names the start of the agent whose boolean result was evaluated", () => {
  const footer = renderFooter(
    runStep("decision", {
      condition: {
        sourceStepId: DECISION.id,
        sourceActivation: 2,
        value: true,
      },
    }),
  );

  const line = footer.querySelector("[data-plan-evaluated]");
  expect(line?.getAttribute("data-plan-evaluated")).toBe("true");
  expect(line?.textContent).toBe(
    i18n.t("plans.decision.evaluated", {
      name: "Quality gate",
      number: 2,
      value: i18n.t("plans.run.passed"),
    }),
  );
});

it("says that the agent did not pass when its result was false", () => {
  const footer = renderFooter(
    runStep("decision", {
      condition: {
        sourceStepId: DECISION.id,
        sourceActivation: 1,
        value: false,
      },
    }),
  );

  const line = footer.querySelector("[data-plan-evaluated]");
  expect(line?.getAttribute("data-plan-evaluated")).toBe("false");
  expect(line?.textContent).toBe(
    i18n.t("plans.decision.evaluated", {
      name: "Quality gate",
      number: 1,
      value: i18n.t("plans.run.notPassed"),
    }),
  );
});

it("names the parameter and its value when the decision read a parameter", () => {
  const footer = renderFooter(
    runStep("decision", {
      condition: {
        sourceStepId: DECISION.id,
        sourceActivation: 1,
        value: true,
        sourceKind: "parameter",
      },
    }),
  );

  expect(footer.querySelector("[data-plan-evaluated]")?.textContent).toBe(
    i18n.t("plans.decision.evaluatedParameter", {
      name: "Quality gate",
      value: "true",
    }),
  );
});

it("takes the name of a node that left the draft from the shown run", () => {
  const footer = renderFooter(
    runStep("decision", {
      condition: { sourceStepId: "removed", sourceActivation: 1, value: true },
    }),
    [runStep("removed", { name: "Old reviewer" })],
  );

  expect(footer.querySelector("[data-plan-evaluated]")?.textContent).toContain(
    "Old reviewer",
  );
});

it("falls back to the unknown node when neither draft nor run knows it", () => {
  const footer = renderFooter(
    runStep("decision", {
      condition: { sourceStepId: "gone", sourceActivation: 1, value: false },
    }),
  );

  expect(footer.querySelector("[data-plan-evaluated]")?.textContent).toContain(
    i18n.t("plans.run.unknownNode"),
  );
});

it("shows what the model answered and its reason with the node it read", () => {
  const footer = renderFooter(
    runStep("decision", {
      verdict: {
        decision: true,
        reason: "The tests pass.",
        model: "synthetic-model",
        isCorrected: false,
        sourceStepId: DECISION.id,
      },
    }),
  );

  const lines = footer.querySelector("[data-plan-verdict]");
  expect(lines?.getAttribute("data-plan-verdict")).toBe("true");
  expect(lines?.textContent).toContain(
    i18n.t("plans.decision.answered", {
      value: "true",
      name: "Quality gate",
    }),
  );
  const reason = screen.getByTitle("The tests pass.");
  expect(reason.textContent).toBe(
    i18n.t("plans.decision.reason", { reason: "The tests pass." }),
  );
  expect(footer.querySelector("[data-plan-evaluated]")).toBeNull();
});

it("shows the class a classifying model chose as its answer", () => {
  const footer = renderFooter(
    runStep("decision", {
      verdict: {
        decision: "urgent",
        reason: "Customer is blocked.",
        model: "synthetic-model",
        isCorrected: false,
        sourceStepId: "gone",
      },
    }),
  );

  expect(
    footer
      .querySelector("[data-plan-verdict]")
      ?.getAttribute("data-plan-verdict"),
  ).toBe("urgent");
  expect(footer.textContent).toContain(
    i18n.t("plans.decision.answered", {
      value: "urgent",
      name: i18n.t("plans.run.unknownNode"),
    }),
  );
});
