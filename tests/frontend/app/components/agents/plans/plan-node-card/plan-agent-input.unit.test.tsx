import { fireEvent, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanAgentInput } from "@/app/components/agents/plans/plan-node-card/plan-agent-input";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";

import { SOURCES } from "../../page61-plan-fixture";
import {
  agentStep,
  flowContext,
  graphActions,
  i18n,
  loopNode,
  planOf,
  renderInFlow,
  scriptStep,
} from "../plan-flow-fixture";

import type { PlanGraphActions } from "@/app/components/agents/plans/use-plan-graph";
import type { AgentParameter } from "@/definition/AgentParameters";
import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";

const NOTES: AgentParameter = {
  name: "notes",
  type: "text",
  description: "What to write about",
  isRequired: false,
  defaultValue: null,
};

const VALUE = {
  id: "value",
  type: "parameter",
  x: 0,
  y: 0,
  name: "value",
  format: "string",
  value: { type: "text", text: "typed" },
} as const;

interface InputSetup {
  readonly step: AgentPlanStep | AgentPlanScript;
  readonly parameter?: AgentParameter;
  readonly draft?: AgentPlanInput;
  readonly graph?: PlanGraphActions;
  readonly canEdit?: boolean;
}

function renderInput(setup: InputSetup): PlanGraphActions {
  const graph = setup.graph ?? graphActions();
  renderInFlow(
    <PlanAgentInput
      step={setup.step}
      label="Writer"
      parameter={setup.parameter ?? NOTES}
    />,
    flowContext({
      graph,
      sources: SOURCES,
      canEdit: setup.canEdit ?? true,
      draft: setup.draft ?? planOf([VALUE, setup.step]),
    }),
  );
  return graph;
}

function writer(
  bindings: Readonly<Record<string, AgentPlanBinding>> = {},
  markdown?: string,
): AgentPlanStep {
  const source = SOURCES.agents.find((agent) => agent.id === "writer");
  if (!source) throw new Error("The writer agent is missing");
  const configuration = copyPlanConfiguration(source);
  return {
    ...agentStep("writer-node", bindings),
    agentId: "writer",
    ...(markdown === undefined
      ? {}
      : {
          configuration: {
            ...configuration,
            template: { ...configuration.template, markdown },
          },
        }),
  };
}

function valueField(): HTMLElement {
  return screen.getByRole("textbox", {
    name: i18n.t("plans.inputValue", { parameter: "notes", name: "Writer" }),
  });
}

function disconnectButton(): HTMLElement {
  return screen.getByRole("button", {
    name: i18n.t("plans.disconnect", { name: "notes" }),
  });
}

it("connects the input from its name and names its description", () => {
  const graph = renderInput({ step: writer() });
  const port = screen.getByRole("button", {
    name: i18n.t("plans.bindPort", { parameter: "notes", name: "Writer" }),
  });
  expect(port.getAttribute("title")).toBe("What to write about");
  expect(port.getAttribute("aria-describedby")).toBeNull();
  fireEvent.click(port);
  expect(graph.connect).toHaveBeenCalledWith("writer-node", "notes");
});

it("marks a required input and an input with an issue", () => {
  renderInput({
    step: writer(),
    parameter: { ...NOTES, description: "", isRequired: true },
    graph: graphActions({
      issues: [{ nodeId: "writer-node", port: "notes", reason: "port" }],
    }),
  });
  const port = screen.getByRole("button", {
    name: i18n.t("plans.bindPort", { parameter: "notes", name: "Writer" }),
  });
  expect(port.getAttribute("title")).toBe("notes");
  expect(port.className).toContain("text-destructive");
  const description = port.getAttribute("aria-describedby") ?? "";
  expect(document.getElementById(description)?.textContent).toBe(
    i18n.t("plans.requiredValue"),
  );
  expect(valueField().getAttribute("aria-invalid")).toBe("true");
});

it("shows a connected value source read only and releases it with the X", () => {
  const step = writer({ notes: { kind: "source", nodeId: "value" } });
  const graph = renderInput({ step });
  expect(screen.queryByRole("textbox")).toBeNull();
  const bound = screen.getByTitle(
    i18n.t("plans.boundValue", { parameter: "notes", source: "typed" }),
  );
  expect(bound.textContent).toContain("typed");
  fireEvent.click(disconnectButton());
  expect(graph.replaceNode).toHaveBeenCalledWith({ ...step, bindings: {} });
});

it("says whether AGENT.md uses a connected result", () => {
  const result = { notes: { kind: "result", stepId: "value" } } as const;
  renderInput({ step: writer(result, "Write {{notes}}") });
  const preview = i18n.t("plans.resultOf", { name: "value" });
  expect(
    screen.getByTitle(
      i18n.t("plans.resultUsed", { source: preview, placeholder: "{{notes}}" }),
    ),
  ).toBeDefined();
  expect(screen.queryByText(i18n.t("plans.resultUnusedShort"))).toBeNull();
});

it("marks a connected result that AGENT.md does not use", () => {
  renderInput({
    step: writer({ notes: { kind: "result", stepId: "value" } }, ""),
  });
  expect(screen.getByText(i18n.t("plans.resultUnusedShort"))).toBeDefined();
});

it("treats a result for an agent without a template as unused", () => {
  renderInput({
    step: {
      ...agentStep("unknown", { notes: { kind: "result", stepId: "value" } }),
      agentId: "gone",
    },
  });
  expect(screen.getByText(i18n.t("plans.resultUnusedShort"))).toBeDefined();
});

it("names the source of a script's connected result without the AGENT.md check", () => {
  const script = {
    ...scriptStep("script", 0),
    inputs: [{ name: "notes", type: "text", isRequired: false }],
    bindings: { notes: { kind: "result", stepId: "value" } },
  } as const;
  renderInput({ step: script });
  const preview = i18n.t("plans.resultOf", { name: "value" });
  expect(
    screen.getByTitle(
      i18n.t("plans.boundValue", { parameter: "notes", source: preview }),
    ),
  ).toBeDefined();
});

it("stores a typed value and restores the default when an agent's value is emptied", () => {
  const step = writer({
    notes: { kind: "literal", value: { type: "text", text: "own" } },
  });
  const graph = renderInput({
    step,
    parameter: {
      ...NOTES,
      defaultValue: { type: "text", text: "fallback" },
    },
  });
  expect(valueField()).toHaveProperty("value", "own");
  expect(valueField().getAttribute("placeholder")).toBe(
    i18n.t("plans.defaultValue", { value: "fallback" }),
  );
  fireEvent.change(valueField(), { target: { value: "next" } });
  expect(graph.replaceNode).toHaveBeenCalledWith({
    ...step,
    bindings: {
      notes: { kind: "literal", value: { type: "text", text: "next" } },
    },
  });
  fireEvent.change(valueField(), { target: { value: "" } });
  expect(graph.replaceNode).toHaveBeenLastCalledWith({ ...step, bindings: {} });
  // An agent's literal is released by emptying it, not by an X.
  expect(
    screen.queryByRole("button", {
      name: i18n.t("plans.disconnect", { name: "notes" }),
    }),
  ).toBeNull();
});

it("keeps empty script text bound until it is disconnected explicitly", () => {
  const script = {
    ...scriptStep("script", 0),
    inputs: [{ name: "notes", type: "text", isRequired: false }],
    bindings: {
      notes: { kind: "literal", value: { type: "text", text: "" } },
    },
  } as const;
  const graph = renderInput({ step: script });
  expect(valueField().getAttribute("placeholder")).toBe(
    i18n.t("plans.scripts.emptyInput"),
  );
  fireEvent.click(disconnectButton());
  expect(graph.replaceNode).toHaveBeenLastCalledWith({
    ...script,
    bindings: {},
  });
});

it("stores emptied script text as a bound value", () => {
  const script = {
    ...scriptStep("script", 0),
    inputs: [{ name: "notes", type: "text", isRequired: false }],
    bindings: {
      notes: { kind: "literal", value: { type: "text", text: "a" } },
    },
  } as const;
  const graph = renderInput({ step: script });
  fireEvent.change(valueField(), { target: { value: "" } });
  expect(graph.replaceNode).toHaveBeenCalledWith({
    ...script,
    bindings: {
      notes: { kind: "literal", value: { type: "text", text: "" } },
    },
  });
});

it("offers no X for an unbound script input and shows its missing value", () => {
  const script = {
    ...scriptStep("script", 0),
    inputs: [{ name: "notes", type: "text", isRequired: false }],
  } as const;
  renderInput({ step: script });
  expect(valueField().getAttribute("placeholder")).toBe(
    i18n.t("plans.noValue"),
  );
  expect(
    screen.queryByRole("button", {
      name: i18n.t("plans.disconnect", { name: "notes" }),
    }),
  ).toBeNull();
});

it("shows a script's typed text with its own placeholder", () => {
  const script = {
    ...scriptStep("script", 0),
    inputs: [{ name: "notes", type: "text", isRequired: false }],
    bindings: {
      notes: { kind: "literal", value: { type: "text", text: "set" } },
    },
  } as const;
  renderInput({ step: script, canEdit: false });
  expect(valueField().getAttribute("placeholder")).toBe(
    i18n.t("plans.noValue"),
  );
  expect(disconnectButton()).toHaveProperty("disabled", true);
});

it("edits a number input without the text controls", () => {
  const graph = renderInput({
    step: writer(),
    parameter: { ...NOTES, type: "number" },
  });
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "3" } });
  expect(graph.replaceNode).toHaveBeenCalledWith({
    ...writer(),
    bindings: {
      notes: { kind: "literal", value: { type: "number", number: 3 } },
    },
  });
  expect(screen.queryByRole("button", { name: /notes ·/u })).toBeNull();
});

it("lets a loop member take a member's result of the previous iteration", async () => {
  const member = writer();
  const loop = loopNode("loop", [member, scriptStep("helper", 1)]);
  const graph = renderInput({ step: member, draft: planOf([loop]) });
  const title = i18n.t("plans.loops.previousChoose");
  fireEvent.keyDown(
    screen.getByRole("button", { name: `${title}: notes · Writer` }),
    { key: "Enter" },
  );
  const menu = await screen.findByRole("menu");
  // Keys of the menu stay with the menu, not with the card.
  fireEvent.keyDown(menu, { key: "Delete" });
  fireEvent.click(
    screen.getByRole("menuitem", {
      name: i18n.t("plans.loops.previousOf", { name: "Script helper" }),
    }),
  );
  expect(graph.replaceNode).toHaveBeenCalledWith({
    ...member,
    bindings: { notes: { kind: "previous", stepId: "helper" } },
  });
});
