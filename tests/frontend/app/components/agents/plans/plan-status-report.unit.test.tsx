import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";

import { PlanStatusReport } from "@/app/components/agents/plans/plan-status-report";
import { createI18n } from "@/app/lib/i18n";

import { syntheticSession } from "../page72-run-fixture";

const i18n = createI18n("en");

it("shows an open report and its actual unmet checks separately from execution", () => {
  const acceptance = syntheticSession().acceptance;
  if (!acceptance) throw new Error("Expected the synthetic assessment");
  render(
    <I18nextProvider i18n={i18n}>
      <PlanStatusReport
        acceptance={{
          ...acceptance,
          issues: ["todo_open:T2", "criterion_unmet:K1", "report_invalid"],
        }}
      />
    </I18nextProvider>,
  );
  expect(
    screen.getByText("Report assessment · open or unverified"),
  ).toBeTruthy();
  expect(screen.getByText("Todo T2 remains open.")).toBeTruthy();
  expect(screen.getByText("Criterion K1 was reported as unmet.")).toBeTruthy();
  expect(
    screen.getByText("The closing report is invalid or incomplete."),
  ).toBeTruthy();
  expect(screen.getByText("Synthetic progress summary")).toBeTruthy();
});
