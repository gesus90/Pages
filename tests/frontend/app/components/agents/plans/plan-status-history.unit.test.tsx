import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import {
  PlanStatusHistory,
  isPlanDecisionResult,
} from "@/app/components/agents/plans/plan-status-history";

import { runStep } from "../page72-run-fixture";
import { i18n, renderTranslated } from "./plan-flow-fixture";

it("recognises the result of a decision by the output it took or the value it read", () => {
  expect(isPlanDecisionResult(runStep("a", { branch: "true" }))).toBe(true);
  expect(
    isPlanDecisionResult(
      runStep("a", {
        condition: { sourceStepId: "x", sourceActivation: 1, value: false },
      }),
    ),
  ).toBe(true);
  expect(isPlanDecisionResult(runStep("a", { passed: true }))).toBe(false);
});

it("shows nothing for a node that ran once and activated no output", () => {
  renderTranslated(<PlanStatusHistory step={runStep("a")} />);

  expect(document.querySelector("[data-plan-history]")).toBeNull();
});

it("names the output a decision activated", () => {
  renderTranslated(
    <PlanStatusHistory
      step={runStep("d", { branch: "false", activation: 2 })}
    />,
  );

  expect(
    screen.getByText(i18n.t("plans.run.branchTaken", { branch: "false" })),
  ).toBeDefined();
});

it("lists the earlier starts oldest first, each with its status and verdict", () => {
  const empty = { output: null, error: null, startedAt: null, endedAt: null };
  renderTranslated(
    <PlanStatusHistory
      step={runStep("check", {
        activation: 3,
        history: [
          { ...empty, activation: 1, status: "succeeded", passed: false },
          { ...empty, activation: 2, status: "failed" },
          { ...empty, activation: 3, status: "succeeded", branch: "true" },
        ],
      })}
    />,
  );
  const items = screen
    .getAllByRole("listitem")
    .map((entry) => entry.textContent);

  expect(
    screen.getByRole("region", { name: i18n.t("plans.run.history") }),
  ).toBeDefined();
  expect(items).toEqual([
    `${i18n.t("plans.run.historyEntry", { number: 1, status: i18n.t("plans.status.succeeded") })} · ${i18n.t("plans.run.notPassed")}`,
    i18n.t("plans.run.historyEntry", {
      number: 2,
      status: i18n.t("plans.status.failed"),
    }),
    `${i18n.t("plans.run.historyEntry", { number: 3, status: i18n.t("plans.status.succeeded") })} · ${i18n.t("plans.run.branchTaken", { branch: "true" })}`,
  ]);
});
