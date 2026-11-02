import { fireEvent, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanNodeCard } from "@/app/components/agents/plans/plan-node-card";
import { planNodeHeight } from "@/app/components/agents/plans/plan-layout";

import { runStep, syntheticRun, syntheticSession } from "../page72-run-fixture";
import { eventEdge, reviewCyclePlan } from "./plan-branching-fixture";
import {
  flowContext,
  graphActions,
  i18n,
  renderInFlow,
} from "./plan-flow-fixture";
import { GROUP_SOURCES } from "./plan-group-fixture";

import type { NodeProps } from "@xyflow/react";
import type { PlanFlowContextValue } from "@/app/components/agents/plans/plan-flow-context";
import type { PlanFlowNode } from "@/app/components/agents/plans/plan-flow-model";
import type {
  AgentPlanInput,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";

function cardProps(plan: AgentPlanInput, id: string): NodeProps<PlanFlowNode> {
  const node = plan.nodes.find((entry) => entry.id === id);
  if (!node) throw new Error(`Missing node ${id}`);
  return {
    id,
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

function renderAgent(
  id: string,
  options: {
    readonly plan?: AgentPlanInput;
    readonly results?: readonly AgentPlanStepResult[];
    readonly context?: Partial<PlanFlowContextValue>;
  } = {},
): { readonly context: PlanFlowContextValue; readonly card: HTMLElement } {
  const plan = options.plan ?? reviewCyclePlan();
  const context = flowContext({
    draft: plan,
    sources: GROUP_SOURCES,
    run: options.results
      ? { ...syntheticRun(), steps: [...options.results] }
      : null,
    ...options.context,
  });
  renderInFlow(<PlanNodeCard {...cardProps(plan, id)} />, context);
  return { context, card: screen.getByRole("article") };
}

function handle(card: HTMLElement, id: string): Element {
  const found = card.querySelector(`[data-handleid="${id}"]`);
  if (!found) throw new Error(`The handle ${id} is missing.`);
  return found;
}

it("gives every agent an event input and a boolean result next to its text result", () => {
  const { card } = renderAgent("fix");

  expect(handle(card, "event-in").getAttribute("data-handlepos")).toBe("left");
  expect(handle(card, "passed-out").getAttribute("data-handlepos")).toBe(
    "right",
  );
  expect(handle(card, "value-out").getAttribute("data-handlepos")).toBe(
    "right",
  );
  expect(handle(card, "flow-in")).toBeDefined();
  expect(card.textContent).toContain(i18n.t("plans.event.in"));
  expect(card.textContent).toContain(i18n.t("plans.event.caption"));
  expect(card.textContent).toContain(i18n.t("plans.passed.caption"));
});

it("keeps the text result apart from the boolean result by its words", () => {
  const { card } = renderAgent("fix");

  expect(card.textContent).toContain(i18n.t("plans.resultOutShort"));
  expect(card.textContent).toContain(i18n.t("plans.passed.label"));
  expect(card.querySelector("[data-plan-event-in]")).not.toBeNull();
});

it("shows the chip that resumes the session only while an event is connected", () => {
  const connected = renderAgent("check");
  expect(
    connected.card.querySelector("[data-plan-event-chip]")?.textContent,
  ).toBe(i18n.t("plans.event.resume"));
});

it("shows no chip for an agent nobody sends an event to", () => {
  const { card } = renderAgent("fix");

  expect(card.querySelector("[data-plan-event-chip]")).toBeNull();
});

it("begins the boolean result and connects the event input from their buttons", () => {
  const { context, card } = renderAgent("check");
  const name = "Codex One";

  fireEvent.click(
    within(card).getByRole("button", {
      name: i18n.t("plans.passed.outLabel", { name }),
    }),
  );
  fireEvent.click(
    within(card).getByRole("button", {
      name: i18n.t("plans.event.inLabel", { name }),
    }),
  );

  expect(context.graph.begin).toHaveBeenCalledWith({
    kind: "passed",
    nodeId: "check",
  });
  expect(context.graph.connect).toHaveBeenCalledWith("check", "event-in");
});

it("marks the event input of an agent whose event the plan refuses", () => {
  const { card } = renderAgent("check", {
    context: {
      graph: graphActions({
        issues: [{ nodeId: "check", port: "event-in", reason: "eventOrder" }],
      }),
    },
  });

  expect(handle(card, "event-in").className).toContain("invalidHandle");
});

it("lets a result end at the event input while a text result is open", () => {
  const { card } = renderAgent("check", {
    context: {
      graph: graphActions({
        connection: { kind: "result", nodeId: "fix" },
        canConnect: (id, parameter) =>
          parameter === "event-in" && id === "check",
      }),
    },
  });
  const input = card.querySelector('[data-plan-port="event-in"]');

  expect(input?.className).toContain("border-success");
});

it("grows an agent by the two rows of its event input and its boolean result", () => {
  const plan = reviewCyclePlan();
  const agent = plan.nodes.find((node) => node.id === "check");
  if (agent?.type !== "agent") throw new Error("Missing agent");

  // 172 base, 96 for the execution rows, the result and the model, 68 for the two new rows, 38 for its one input.
  expect(planNodeHeight(agent, GROUP_SOURCES)).toBe(172 + 96 + 68 + 38);
});

it("notes a later start, the boolean result and the event that started the agent", () => {
  const { card } = renderAgent("check", {
    results: [
      runStep("fix", { name: "Nachbessern", status: "succeeded" }),
      runStep("check", {
        status: "succeeded",
        activation: 3,
        passed: false,
        trigger: {
          kind: "event",
          promptLength: 120,
          sources: [{ stepId: "fix", activation: 2 }],
        },
      }),
    ],
  });

  expect(card.querySelector("[data-plan-activation]")?.textContent).toBe(
    i18n.t("plans.run.activation", { number: 3 }),
  );
  expect(card.querySelector('[data-plan-passed="false"]')?.textContent).toBe(
    i18n.t("plans.run.notPassed"),
  );
  expect(card.querySelector("[data-plan-trigger]")?.textContent).toBe(
    i18n.t("plans.run.triggeredBy", { names: "Codex Two" }),
  );
});

function secondStart(role: "continued" | "recovered"): AgentPlanStepResult {
  return runStep("check", {
    status: "succeeded",
    activation: 2,
    session: {
      ...syntheticSession(),
      event: {
        activation: 2,
        role,
        turn: 2,
        acpSessionId: "session",
        sourceStepId: "fix",
      },
    },
  });
}

it("says in words that a later start went on in its session", () => {
  const { card } = renderAgent("check", {
    results: [secondStart("continued")],
  });

  expect(
    card.querySelector('[data-plan-session="continued"]')?.textContent,
  ).toBe(i18n.t("plans.run.sessionContinued"));
});

it("says in words that a later start began a new session, never the same one", () => {
  const { card } = renderAgent("check", {
    results: [secondStart("recovered")],
  });

  expect(
    card.querySelector('[data-plan-session="recovered"]')?.textContent,
  ).toBe(i18n.t("plans.run.sessionRecovered"));
  expect(card.querySelector('[data-plan-session="continued"]')).toBeNull();
});

it("names every source of an event that several nodes sent together", () => {
  const plan = reviewCyclePlan();
  const { card } = renderAgent("check", {
    plan: { ...plan, edges: [...plan.edges, eventEdge("decision", "check")] },
    results: [
      runStep("check", {
        status: "running",
        trigger: {
          kind: "event",
          promptLength: 10,
          sources: [
            { stepId: "fix", activation: 1 },
            { stepId: "unknown", activation: 1 },
          ],
        },
      }),
    ],
  });

  expect(card.querySelector("[data-plan-trigger]")?.textContent).toBe(
    i18n.t("plans.run.triggeredBy", {
      names: `Codex Two, ${i18n.t("plans.run.unknownNode")}`,
    }),
  );
});

it("shows a passed agent as passed and shows no note for a node that ran once", () => {
  const passed = renderAgent("check", {
    results: [runStep("check", { status: "succeeded", passed: true })],
  });
  expect(
    passed.card.querySelector('[data-plan-passed="true"]')?.textContent,
  ).toBe(i18n.t("plans.run.passed"));
  expect(passed.card.querySelector("[data-plan-activation]")).toBeNull();
});

it("shows no note for an agent that ran once without a decision", () => {
  const { card } = renderAgent("fix", {
    results: [runStep("fix", { status: "succeeded", activation: 1 })],
  });

  expect(card.querySelector("[data-plan-run-notes]")).toBeNull();
});

it("marks an agent on a branch that was not activated with a dashed border", () => {
  const { card } = renderAgent("fix", {
    results: [runStep("fix", { status: "skipped" })],
  });

  expect(card.className).toContain("border-dashed");
  expect(card.className).not.toContain("opacity");
  expect(card.textContent).toContain(i18n.t("plans.status.skipped"));
});
