import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanRemoteAccessDetails } from "@/app/components/agents/plans/plan-remote-access-details";

import {
  i18n,
  renderTranslated,
  runStep,
  stepExecution,
} from "./plan-panel-fixture";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";

const DIGEST = "a".repeat(64);

function renderDetails(step: AgentPlanStepResult): HTMLElement {
  return renderTranslated(<PlanRemoteAccessDetails step={step} />).container;
}

it("shows nothing without frozen resources, access evidence or a failing asset", () => {
  expect(renderDetails(runStep("step")).textContent).toBe("");
  expect(
    renderDetails(runStep("step", { execution: stepExecution() })).textContent,
  ).toBe("");
});

it("names the frozen resource versions and a changed reference", () => {
  renderDetails(
    runStep("step", {
      status: "failed",
      error: "parameter_ticket_changed",
      execution: stepExecution(undefined, {
        resources: [
          {
            parameter: "ticket",
            type: "ticket",
            id: "t1",
            name: "SYN-1",
            version: "v4",
          },
        ],
      }),
    }),
  );

  expect(screen.getByRole("alert").textContent).toBe(
    i18n.t("plans.remoteAccess.referencesChanged"),
  );
  expect(
    screen.getByText(i18n.t("plans.remoteAccess.resources")),
  ).toBeDefined();
  expect(
    screen.getByText(`ticket · ${i18n.t("plans.remoteAccess.ticket")} · SYN-1`),
  ).toBeDefined();
  expect(
    screen.getByText(i18n.t("plans.remoteAccess.version", { version: "v4" })),
  ).toBeDefined();
});

it("names a failing asset and the failure of the step, in general words for an unknown code", () => {
  renderDetails(
    runStep("step", {
      status: "failed",
      error: "synthetic_unknown",
      assetFailure: { id: "a1", name: "spec.pdf", cause: "asset_too_large" },
    }),
  );

  expect(
    screen.getAllByRole("alert").map((alert) => alert.textContent),
  ).toEqual([
    i18n.t("plans.remoteAccess.assetFailure", {
      id: "a1",
      name: "spec.pdf",
      cause: i18n.t("settings.agents.error.asset_too_large"),
    }),
    i18n.t("settings.agents.error.general"),
  ]);
});

it("names no failure for a step that did not fail", () => {
  renderDetails(
    runStep("step", {
      status: "succeeded",
      error: "plan_step_failed",
      assetFailure: { id: "a1", name: "spec.pdf", cause: "asset_too_large" },
    }),
  );

  expect(screen.getAllByRole("alert")).toHaveLength(1);
});

it("lists the transmitted files and the Pages access events", () => {
  const file = {
    parameter: "notes",
    type: "text/plain",
    size: 12,
    digest: DIGEST,
  };
  renderDetails(
    runStep("step", {
      resourceAccess: {
        files: [
          { ...file, name: "plain.txt" },
          {
            ...file,
            name: "linked.txt",
            asset: { source: "ticket", id: "a2", link: "/assets/a2" },
          },
        ],
        pages: "closed",
        events: [
          {
            at: "2026-10-15T10:00:00.000Z",
            tool: "tickets.read",
            target: "SYN-1",
            result: "ok",
          },
          {
            at: "2026-10-15T10:00:01.000Z",
            tool: "wiki.read",
            target: null,
            result: "denied",
          },
        ],
      },
    }),
  );

  expect(screen.getByText(/plain\.txt/u)).toBeDefined();
  expect(screen.getByText(/linked\.txt/u)).toBeDefined();
  expect(screen.getByText(i18n.t("plans.remoteAccess.closed"))).toBeDefined();
  expect(
    screen.getByText(
      `tickets.read · SYN-1 · ${i18n.t("plans.remoteAccess.ok")}`,
      { exact: false },
    ),
  ).toBeDefined();
  expect(
    screen.getByText(`wiki.read · — · ${i18n.t("plans.remoteAccess.denied")}`, {
      exact: false,
    }),
  ).toBeDefined();
  expect(screen.queryByText(i18n.t("plans.remoteAccess.noFiles"))).toBeNull();
});

it("says that no file was transmitted", () => {
  renderDetails(
    runStep("step", {
      resourceAccess: { files: [], pages: "active", events: [] },
    }),
  );

  expect(screen.getByText(i18n.t("plans.remoteAccess.noFiles"))).toBeDefined();
  expect(screen.getByText(i18n.t("plans.remoteAccess.active"))).toBeDefined();
});
