import { fireEvent, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanNodeCard } from "@/app/components/agents/plans/plan-node-card";

import { runStep, syntheticRun } from "../page72-run-fixture";
import { DECISION, reviewCyclePlan } from "./plan-branching-fixture";
import {
  flowContext,
  graphActions,
  i18n,
  planOf,
  renderInFlow,
} from "./plan-flow-fixture";
import { GROUP_SOURCES } from "./plan-group-fixture";

import type { NodeProps } from "@xyflow/react";
import type { PlanFlowContextValue } from "@/app/components/agents/plans/plan-flow-context";
import type { PlanFlowNode } from "@/app/components/agents/plans/plan-flow-model";
import type {
  AgentPlanDecision,
  AgentPlanInput,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";

function cardProps(node: AgentPlanDecision): NodeProps<PlanFlowNode> {
  return {
    id: node.id,
    type: "plan",
    data: { node },
    selected: false,
    dragging: false,
    draggable: true,
    selectable: true,
    deletable: true,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

function renderDecision(
  options: {
    readonly decision?: AgentPlanDecision;
    readonly draft?: AgentPlanInput;
    readonly result?: AgentPlanStepResult;
    readonly context?: Partial<PlanFlowContextValue>;
  } = {},
): { readonly context: PlanFlowContextValue; readonly card: HTMLElement } {
  const decision = options.decision ?? DECISION;
  const run = options.result
    ? {
        ...syntheticRun(),
        steps: [options.result],
      }
    : null;
  const context = flowContext({
    draft: options.draft ?? planOf([decision]),
    sources: GROUP_SOURCES,
    run,
    ...options.context,
  });
  renderInFlow(<PlanNodeCard {...cardProps(decision)} />, context);
  return { context, card: screen.getByRole("article") };
}

function handle(card: HTMLElement, id: string): Element {
  const found = card.querySelector(`[data-handleid="${id}"]`);
  if (!found) throw new Error(`The handle ${id} is missing.`);
  return found;
}

function row(card: HTMLElement, branch: "true" | "false"): HTMLElement {
  const found = card.querySelector<HTMLElement>(
    `[data-plan-branch="${branch}"]`,
  );
  if (!found) throw new Error(`The ${branch} output is missing.`);
  return found;
}

it("shows a decision as a compact logic card with a condition input and two outputs", () => {
  const { card } = renderDecision();

  expect(card.getAttribute("aria-label")).toBe(
    i18n.t("plans.nodeType.decision"),
  );
  expect(card.textContent).toContain(i18n.t("plans.decision.caption"));
  expect(card.textContent).toContain(i18n.t("plans.decision.boolean"));
  expect(card.textContent).toContain(i18n.t("plans.decision.footer"));
  expect(card.className).toContain("bg-plan-logic-subtle");
  expect(handle(card, "condition-in").getAttribute("data-handlepos")).toBe(
    "left",
  );
  expect(handle(card, "true-out").getAttribute("data-handlepos")).toBe("right");
  expect(handle(card, "false-out").getAttribute("data-handlepos")).toBe(
    "right",
  );
  // A decision orders its followers through its outputs, not through flow ports of its own.
  expect(card.querySelector('[data-handleid="flow-in"]')).toBeNull();
  expect(card.querySelector('[data-handleid="flow-out"]')).toBeNull();
});

it("names each output by words as well as by colour", () => {
  const { card } = renderDecision();

  expect(row(card, "true").textContent).toContain(
    i18n.t("plans.decision.when.true"),
  );
  expect(row(card, "true").textContent).toContain("true");
  expect(row(card, "false").textContent).toContain(
    i18n.t("plans.decision.when.false"),
  );
  expect(row(card, "false").textContent).toContain("false");
  expect(
    within(card).getByRole("button", {
      name: i18n.t("plans.decision.outLabel", {
        branch: "true",
        name: i18n.t("plans.nodeType.decision"),
      }),
    }).className,
  ).toContain("text-success");
  expect(
    within(card).getByRole("button", {
      name: i18n.t("plans.decision.outLabel", {
        branch: "false",
        name: i18n.t("plans.nodeType.decision"),
      }),
    }).className,
  ).toContain("text-warning");
});

it("says that no condition is connected, then names the agent it reads", () => {
  const unconnected = renderDecision();
  expect(
    unconnected.card.querySelector("[data-plan-condition]")?.textContent,
  ).toBe(i18n.t("plans.decision.notConnected"));
});

it("names the agent whose boolean result the decision reads", () => {
  const { card } = renderDecision({ draft: reviewCyclePlan() });

  expect(card.querySelector("[data-plan-condition]")?.textContent).toBe(
    i18n.t("plans.decision.reads", { name: "Codex One" }),
  );
});

it("begins a branch connection from either output and a condition connection at its input", () => {
  const { context, card } = renderDecision();
  const name = i18n.t("plans.nodeType.decision");

  fireEvent.click(
    within(card).getByRole("button", {
      name: i18n.t("plans.decision.outLabel", { branch: "true", name }),
    }),
  );
  fireEvent.click(
    within(card).getByRole("button", {
      name: i18n.t("plans.decision.outLabel", { branch: "false", name }),
    }),
  );
  fireEvent.click(
    within(card).getByRole("button", {
      name: i18n.t("plans.decision.conditionLabel", { name }),
    }),
  );

  expect(context.graph.begin).toHaveBeenNthCalledWith(1, {
    kind: "branch",
    nodeId: "decision",
    branch: "true",
  });
  expect(context.graph.begin).toHaveBeenNthCalledWith(2, {
    kind: "branch",
    nodeId: "decision",
    branch: "false",
  });
  expect(context.graph.connect).toHaveBeenCalledWith(
    "decision",
    "condition-in",
  );
});

it("marks the condition input and an output without a continuation as findings", () => {
  const { card } = renderDecision({
    context: {
      graph: graphActions({
        issues: [
          {
            nodeId: "decision",
            port: "condition-in",
            reason: "decisionCondition",
          },
          { nodeId: "decision", port: "false-out", reason: "decisionBranch" },
        ],
      }),
    },
  });

  expect(handle(card, "condition-in").className).toContain("invalidHandle");
  expect(handle(card, "false-out").className).toContain("invalidHandle");
  expect(handle(card, "true-out").className).not.toContain("invalidHandle");
  expect(card.className).toContain("border-destructive");
});

it("takes the name of the decision for its title and its edit button", () => {
  const { context } = renderDecision({
    decision: { ...DECISION, name: "Prüfen & bewerten" },
    context: { onEdit: undefined },
  });

  expect(screen.getByText("Prüfen & bewerten")).toBeDefined();
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.editNamed", { name: "Prüfen & bewerten" }),
    }),
  );
  expect(context.graph.select).toHaveBeenCalledWith("decision");
});

it("opens the dialog of the decision from its pencil", () => {
  const onEdit = (id: string): void => {
    opened.push(id);
  };
  const opened: string[] = [];
  renderDecision({ context: { onEdit } });

  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.editNamed", {
        name: i18n.t("plans.nodeType.decision"),
      }),
    }),
  );

  expect(opened).toEqual(["decision"]);
});

it("highlights the output a run took and mutes the other one without fading it", () => {
  const { card } = renderDecision({
    result: runStep("decision", {
      status: "succeeded",
      activation: 2,
      branch: "false",
      condition: { sourceStepId: "check", sourceActivation: 2, value: false },
    }),
    draft: reviewCyclePlan(),
  });

  expect(row(card, "false").getAttribute("data-plan-taken")).toBe("true");
  expect(row(card, "true").getAttribute("data-plan-taken")).toBeNull();
  expect(row(card, "true").getAttribute("data-plan-muted")).toBe("true");
  expect(row(card, "false").getAttribute("data-plan-muted")).toBeNull();
  // Faded text would fall below the contrast of the plan editor.
  expect(row(card, "true").className).not.toContain("opacity");
  expect(row(card, "true").querySelector("button")?.className).toContain(
    "text-muted-foreground",
  );
  expect(row(card, "false").querySelector("button")?.className).toContain(
    "text-warning",
  );
  expect(card.querySelector("[data-plan-evaluated]")?.textContent).toBe(
    i18n.t("plans.decision.evaluated", {
      name: "Codex One",
      number: 2,
      value: i18n.t("plans.run.notPassed"),
    }),
  );
  expect(card.querySelector("[data-plan-activation]")?.textContent).toBe(
    i18n.t("plans.run.activation", { number: 2 }),
  );
});

it("marks a decision that was skipped with a dashed border and says so", () => {
  const { card } = renderDecision({
    result: runStep("decision", { status: "skipped" }),
  });

  expect(card.className).toContain("border-dashed");
  expect(card.className).not.toContain("opacity");
  expect(card.textContent).toContain(i18n.t("plans.status.skipped"));
});
