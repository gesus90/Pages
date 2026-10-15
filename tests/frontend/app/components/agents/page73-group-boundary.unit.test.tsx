import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { PlanGroupParameters } from "@/app/components/agents/plans/plan-group-parameters";
import { PlanRunDiagnostics } from "@/app/components/agents/plans/plan-run-diagnostics";
import { PlanRunContract } from "@/app/components/agents/plans/plan-run-contract";

import { i18n, SOURCES, planServer } from "./page61-plan-fixture";
import { runStep, syntheticRun, syntheticSession } from "./page72-run-fixture";

import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";

function boundaryGroup(): AgentPlanGroup {
  return {
    id: "group",
    type: "group",
    name: "Group",
    x: 0,
    y: 0,
    steps: [],
    parameters: [
      {
        id: "stable-port",
        name: "common",
        type: "text",
        description: "",
        isRequired: true,
        defaultValue: null,
      },
    ],
    bindings: { common: { kind: "source", nodeId: "spare" } },
  };
}

function BoundaryEditor(): React.ReactElement {
  const [group, setGroup] = useState(boundaryGroup());
  const draft = planServer().plan;
  if (!draft) throw new Error("Missing plan");
  return (
    <PlanGroupParameters
      group={group}
      draft={draft}
      sources={SOURCES}
      onChange={setGroup}
      disabled={false}
    />
  );
}

it("edits the displayed external source and keeps the connection through a boundary rename", async () => {
  const originalScroll = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  try {
    render(
      <I18nextProvider i18n={i18n}>
        <BoundaryEditor />
      </I18nextProvider>,
    );
    const name = i18n.t("plans.groups.externalSource", { name: "common" });
    expect(screen.getByRole("combobox", { name }).textContent).toContain(
      "spare",
    );
    fireEvent.keyDown(screen.getByRole("combobox", { name }), { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("option", { name: i18n.t("plans.useDefault") }),
    );
    expect(screen.getByRole("combobox", { name }).textContent).toContain(
      i18n.t("plans.useDefault"),
    );
    fireEvent.keyDown(screen.getByRole("combobox", { name }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "spare" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: i18n.t("plans.groups.portName") }),
      { target: { value: "renamed" } },
    );
    expect(
      screen.getByRole("combobox", {
        name: i18n.t("plans.groups.externalSource", { name: "renamed" }),
      }).textContent,
    ).toContain("spare");
  } finally {
    HTMLElement.prototype.scrollIntoView = originalScroll;
  }
});

it("locks a group's external source while editing is disabled", () => {
  const draft = planServer().plan;
  if (!draft) throw new Error("Missing plan");
  const onChange = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <PlanGroupParameters
        group={boundaryGroup()}
        draft={draft}
        sources={SOURCES}
        onChange={onChange}
        disabled
      />
    </I18nextProvider>,
  );
  expect(
    screen.getByRole("combobox", {
      name: i18n.t("plans.groups.externalSource", { name: "common" }),
    }),
  ).toHaveProperty("disabled", true);
  expect(onChange).not.toHaveBeenCalled();
});

it("names the failed internal agent and the acceptance failure beside its group status", () => {
  const agent = runStep("first", {
    name: "Internal test agent",
    groupId: "group",
    status: "failed",
    error: "plan_group_acceptance_failed",
  });
  const run = {
    ...syntheticRun(),
    status: "failed" as const,
    steps: [
      agent,
      runStep("group", {
        name: "Test group",
        status: "failed",
        failedStepId: "first",
        error: "plan_group_acceptance_failed",
      }),
    ],
  };
  render(
    <I18nextProvider i18n={i18n}>
      <PlanRunDiagnostics run={run} agents={[agent]} />
    </I18nextProvider>,
  );
  const diagnostics = screen.getByRole("region", {
    name: i18n.t("plans.runDiagnostics"),
  });
  expect(
    within(diagnostics).getByText(
      i18n.t("plans.groups.failedAgent", { name: agent.name }),
    ),
  ).toBeDefined();
  expect(within(diagnostics).getByRole("alert").textContent).toBe(
    i18n.t("settings.agents.error.plan_group_acceptance_failed"),
  );
});

it("explains required group acceptance without the standalone diagnostic-only hint", () => {
  const session = syntheticSession();
  if (!session.contract) throw new Error("Missing contract");
  render(
    <I18nextProvider i18n={i18n}>
      <PlanRunContract
        contract={session.contract}
        acceptance={session.acceptance}
        requiresAcceptance
      />
    </I18nextProvider>,
  );
  expect(screen.getByText(i18n.t("plans.groups.acceptanceHint"))).toBeDefined();
  expect(screen.queryByText(i18n.t("plans.session.diagnosticHint"))).toBeNull();
});
