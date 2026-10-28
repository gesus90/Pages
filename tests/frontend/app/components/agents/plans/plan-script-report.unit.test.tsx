import { act, render, renderHook, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";

import { PlanScriptReport } from "@/app/components/agents/plans/plan-script/plan-script-report";
import { usePlanScriptForm } from "@/app/components/agents/plans/plan-script/use-plan-script-form";
import { hasOpenPlanReport } from "@/app/components/agents/plans/plan-status";
import { createI18n } from "@/app/lib/i18n";

import { runStep } from "../page72-run-fixture";

import type { AgentPlanScript } from "@/definition/AgentPlanScript";

const script: AgentPlanScript = {
  id: "review",
  type: "script",
  name: "Review",
  x: 0,
  y: 0,
  interpreterProfileId: "python",
  content: "print('synthetic')",
  inputs: [{ name: "findings", type: "text", isRequired: true }],
  outputs: [{ name: "result", type: "text", policy: "gate" }],
  timeoutSeconds: 60,
  bindings: { findings: { kind: "result", stepId: "previous" } },
};

it("preserves and explicitly changes a script output policy without changing bindings", () => {
  const { result } = renderHook(() =>
    usePlanScriptForm(script, {
      interpreters: undefined,
      defaultOutput: "result",
    }),
  );
  expect(result.current.values.outputPolicy).toBe("gate");
  act(() => result.current.change({ outputPolicy: "report" }));
  let saved: ReturnType<typeof result.current.submit> = null;
  act(() => {
    saved = result.current.submit();
  });
  expect(saved).toMatchObject({
    configuration: {
      outputs: [{ name: "result", type: "text", policy: "report" }],
    },
    bindings: { findings: { kind: "result", stepId: "previous" } },
  });
});

it("shows completed report generation with failed checks as a warning", () => {
  const report = {
    status: "failed" as const,
    summary: "One synthetic check failed",
    checkCount: 3,
    failedCount: 1,
    partialCount: 0,
  };
  expect(
    hasOpenPlanReport(runStep("review", { status: "succeeded", report })),
  ).toBe(true);
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <PlanScriptReport report={report} />
    </I18nextProvider>,
  );
  expect(screen.getByText("Script review report · failed")).toBeTruthy();
  expect(screen.getByText("One synthetic check failed")).toBeTruthy();
  expect(screen.getByText("Checks: 3 · failed: 1 · partial: 0")).toBeTruthy();
});
