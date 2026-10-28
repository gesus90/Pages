import { fireEvent, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanParameterFields } from "@/app/components/agents/plans/plan-node-card/plan-parameter-fields";

import {
  flowContext,
  graphActions,
  i18n,
  renderInFlow,
} from "../plan-flow-fixture";

import type { PlanGraphActions } from "@/app/components/agents/plans/use-plan-graph";
import type { AgentPlanParameter } from "@/definition/AgentPlan";

function parameter(
  overrides: Partial<AgentPlanParameter> = {},
): AgentPlanParameter {
  return {
    id: "value",
    type: "parameter",
    x: 0,
    y: 0,
    name: "notes",
    format: "string",
    value: { type: "text", text: "kept" },
    ...overrides,
  };
}

function renderFields(
  node: AgentPlanParameter,
  canEdit = true,
): PlanGraphActions & { readonly unmount: () => void } {
  const graph = graphActions();
  const { unmount } = renderInFlow(
    <PlanParameterFields node={node} />,
    flowContext({ graph, canEdit }),
  );
  return { ...graph, unmount };
}

async function chooseType(name: string, type: string): Promise<void> {
  fireEvent.keyDown(
    screen.getByRole("combobox", {
      name: i18n.t("plans.parameterType", { name }),
    }),
    { key: "Enter" },
  );
  fireEvent.click(
    await screen.findByRole("option", {
      name: i18n.t(`plans.valueTypes.${type}`),
    }),
  );
}

it("renames the parameter and edits its text value in place", () => {
  const node = parameter();
  const graph = renderFields(node);
  fireEvent.change(
    screen.getByRole("textbox", { name: i18n.t("plans.parameterName") }),
    { target: { value: "summary" } },
  );
  expect(graph.replaceNode).toHaveBeenCalledWith({ ...node, name: "summary" });
  fireEvent.change(
    screen.getByRole("textbox", {
      name: i18n.t("plans.parameterValue", { name: "notes" }),
    }),
    { target: { value: "changed" } },
  );
  expect(graph.replaceNode).toHaveBeenCalledWith({
    ...node,
    value: { type: "text", text: "changed" },
  });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps the text when switching between text formats", async () => {
  const node = parameter();
  const graph = renderFields(node);
  await chooseType("notes", "json");
  expect(graph.replaceNode).toHaveBeenCalledWith({
    ...node,
    format: "json",
    value: { type: "text", text: "kept" },
  });
});

it("starts an empty text when a value of another type becomes text", async () => {
  const node = parameter({
    format: "number",
    value: { type: "number", number: 5 },
  });
  const graph = renderFields(node);
  expect(
    screen.getByRole("combobox", {
      name: i18n.t("plans.parameterType", { name: "notes" }),
    }).textContent,
  ).toBe(i18n.t("plans.valueTypes.number"));
  await chooseType("notes", "string");
  expect(graph.replaceNode).toHaveBeenCalledWith({
    ...node,
    format: "string",
    value: { type: "text", text: "" },
  });
});

it("starts each reference and number type with its empty value", async () => {
  const expected = {
    number: { format: "number", value: { type: "number", number: 0 } },
    ticket: { format: "string", value: { type: "ticket", ticketId: "" } },
    workspace: {
      format: "string",
      value: { type: "workspace", workspaceId: "" },
    },
    wiki: { format: "string", value: { type: "wiki", pageId: "" } },
  } as const;
  for (const [type, change] of Object.entries(expected)) {
    const node = parameter();
    const graph = renderFields(node);
    await chooseType("notes", type);
    expect(graph.replaceNode).toHaveBeenCalledWith({ ...node, ...change });
    graph.unmount();
  }
});

it("marks an invalid name and an unreadable JSON value", () => {
  renderFields(
    parameter({
      name: "two words",
      format: "json",
      value: { type: "text", text: "{" },
    }),
  );
  const alerts = screen.getAllByRole("alert").map((alert) => alert.textContent);
  expect(alerts).toEqual([
    i18n.t("plans.validation.name"),
    i18n.t("plans.validation.json"),
  ]);
  expect(
    screen
      .getByRole("textbox", { name: i18n.t("plans.parameterName") })
      .getAttribute("aria-invalid"),
  ).toBe("true");
});

it("locks every field without edit rights", () => {
  renderFields(parameter(), false);
  expect(
    screen.getByRole("textbox", { name: i18n.t("plans.parameterName") }),
  ).toHaveProperty("disabled", true);
  expect(
    screen.getByRole("combobox", {
      name: i18n.t("plans.parameterType", { name: "notes" }),
    }),
  ).toHaveProperty("disabled", true);
});
