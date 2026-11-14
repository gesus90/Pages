import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanCard } from "@/app/components/agents/plans/plan-node-card/plan-card";
import { PlanRunPanel } from "@/app/components/agents/plans/plan-run-panel";
import { planWarnings } from "@/definition/AgentPlanWarnings";

import { agentNode, ownCopy } from "./plan-group-fixture";
import { flowContext, graphActions, renderInFlow } from "./plan-flow-fixture";
import {
  actionScene,
  i18n,
  planControl,
  planPage,
  planView,
  recoveryState,
  renderWithEditor,
} from "./plan-panel-fixture";

import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { AgentPlanStep } from "@/definition/AgentPlan";

vi.mock("@/app/components/agents/plans/use-plan-recovery", async () => ({
  usePlanRecovery: () => recoveryState(),
}));

function requiredNode(): AgentPlanStep {
  const configuration = ownCopy("Ticket umsetzen", 1);
  return agentNode("work", "agent", {
    configuration: {
      ...configuration,
      template: {
        ...configuration.template,
        markdown: "Ticket: {{ticket}}",
        parameters: [
          {
            name: "ticket",
            type: "ticket",
            description: "",
            isRequired: true,
            defaultValue: null,
          },
        ],
      },
    },
  });
}

it.each<AgentPlanIssue>([
  { nodeId: "work", port: "ticket", reason: "required" },
  { nodeId: "work", port: null, reason: "unreachable" },
])("shows a quiet warning with a field explanation for $reason", (issue) => {
  renderInFlow(
    <PlanCard
      node={requiredNode()}
      label="Ticket umsetzen"
      title="Ticket umsetzen"
    >
      <p>Inputs</p>
    </PlanCard>,
    flowContext({ graph: graphActions({ issues: [issue] }) }),
  );
  const article = screen.getByRole("article", { name: "Ticket umsetzen" });
  const warning = within(article).getByRole("img");
  expect(warning.title).toBe(warning.getAttribute("aria-label"));
  expect(warning.title).toContain(issue.port ?? "Start");
  expect(warning.tabIndex).toBe(0);
  expect(article.className).not.toContain("border-destructive");
});

it("collects node and field warnings on Start and submits immediately without another dialog", async () => {
  const inspectOwners = vi.fn<typeof fetch>(async () =>
    Response.json({ owners: [] }),
  );
  vi.stubGlobal("fetch", inspectOwners);
  const work = requiredNode();
  const free = agentNode("free", "missing");
  const plan = planView({
    nodes: [
      { id: "start", type: "start", x: 0, y: 0 },
      work,
      free,
      { id: "end", type: "end", x: 900, y: 0 },
    ],
    edges: [
      { from: "start", to: "work", fromPort: "flow-out", toPort: "flow-in" },
      { from: "work", to: "end", fromPort: "flow-out", toPort: "flow-in" },
    ],
  });
  const scene = actionScene({ ok: true, intent: "play-plan" });
  const warnings = planWarnings(plan, []);
  expect(warnings).toContainEqual({
    nodeId: "work",
    port: "ticket",
    reason: "required",
  });
  expect(warnings).toContainEqual({
    nodeId: "free",
    port: null,
    reason: "unreachable",
  });
  renderWithEditor(planPage({ selected: plan }), scene, (editor) => (
    <PlanRunPanel
      page={planPage({ selected: plan })}
      editor={editor}
      control={planControl()}
      run={null}
      error={null}
      onRunStarted={vi.fn()}
      onRecoveryDecided={vi.fn()}
    />
  ));
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.panel.play") }),
  );
  await waitFor(() => expect(scene.submissions).toHaveLength(1));
  expect(inspectOwners).toHaveBeenCalledOnce();
  const summary = screen.getByRole("list", {
    name: i18n.t("plans.panel.issuesLabel"),
  });
  expect(summary.textContent).toContain("Ticket umsetzen");
  expect(summary.textContent).toContain("ticket");
  expect(summary.textContent).toContain("starts anyway");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(scene.submissions[0]?.get("intent")).toBe("play-plan");
});
