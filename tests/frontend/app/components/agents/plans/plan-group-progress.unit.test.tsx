import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import {
  PlanGroupCount,
  PlanGroupStatus,
} from "@/app/components/agents/plans/plan-group-progress";

import { i18n, renderTranslated } from "./plan-group-fixture";

import type { PlanGroupProgress } from "@/definition/AgentPlanGroupProgress";

function progress(overrides: Partial<PlanGroupProgress>): PlanGroupProgress {
  return { completed: 0, total: 2, state: "ready", error: null, ...overrides };
}

function doneArcs(container: HTMLElement): readonly Element[] {
  return [
    ...container.querySelectorAll(
      'circle[stroke="var(--color-plan-progress-done)"]',
    ),
  ];
}

it("shows the state of a group in its tone, with the run error in the hint", () => {
  const { container, rerender } = renderTranslated(
    <PlanGroupStatus progress={progress({ state: "running" })} />,
  );
  const running = screen.getByText(i18n.t("plans.groups.state.running"));
  expect(running.getAttribute("title")).toBe("Running");
  expect(running.className).toContain("text-status-active");
  rerender(
    <PlanGroupStatus
      progress={progress({ state: "failed", error: "name_taken" })}
    />,
  );
  const failed = screen.getByText(i18n.t("plans.groups.state.failed"));
  expect(failed.getAttribute("title")).toBe(
    `${i18n.t("plans.groups.state.failed")} · ${i18n.t("settings.agents.error.name_taken")}`,
  );
  expect(failed.className).toContain("text-destructive");
  expect(container.querySelectorAll("span[aria-hidden]")).toHaveLength(1);
});

it("draws a compact ring that fills with completed turns and never overflows", () => {
  const { container, rerender } = renderTranslated(
    <PlanGroupCount progress={progress({ completed: 1 })} isCompact />,
  );
  const ring = screen.getByRole("img", {
    name: i18n.t("plans.progress.count", { completed: 1, total: 2 }),
  });
  expect(ring.textContent).toBe("1 / 2");
  expect(doneArcs(container)[0]?.getAttribute("stroke-dasharray")).toBe(
    "50 100",
  );
  rerender(
    <PlanGroupCount
      progress={progress({ completed: 3, total: 2 })}
      isCompact
    />,
  );
  expect(doneArcs(container)[0]?.getAttribute("stroke-dasharray")).toBe(
    "100 100",
  );
  rerender(<PlanGroupCount progress={progress({})} isCompact />);
  expect(doneArcs(container)).toHaveLength(0);
});

it("never paints a done arc for an empty or unknown total", () => {
  const { container, rerender } = renderTranslated(
    <PlanGroupCount progress={progress({ total: 0 })} isCompact />,
  );
  expect(screen.getByRole("img").textContent).toBe("0 / 0");
  expect(doneArcs(container)).toHaveLength(0);
  rerender(
    <PlanGroupCount
      progress={progress({ completed: 1, total: null })}
      isCompact
    />,
  );
  expect(
    screen.getByRole("img", { name: i18n.t("plans.progress.unknownTotal") })
      .textContent,
  ).toBe("1 / —");
  expect(doneArcs(container)).toHaveLength(0);
});

it("shows the expanded count as text with its caption and without a ring", () => {
  const { container } = renderTranslated(
    <PlanGroupCount
      progress={progress({ completed: 2, total: 2 })}
      isCompact={false}
    />,
  );
  expect(screen.getByRole("img").textContent).toBe(
    `2 / 2${i18n.t("plans.progress.completed")}`,
  );
  expect(container.querySelector("svg")).toBeNull();
});
