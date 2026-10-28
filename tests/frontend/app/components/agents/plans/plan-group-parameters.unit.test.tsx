import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanGroupParameters } from "@/app/components/agents/plans/plan-group-parameters";

import {
  GROUP_SOURCES,
  agentNode,
  i18n,
  ownCopy,
  planOf,
  renderTranslated,
  sessionGroup,
} from "./plan-group-fixture";

import type { AgentPlanInput } from "@/definition/AgentPlan";
import type {
  AgentPlanGroup,
  AgentPlanGroupParameter,
} from "@/definition/AgentPlanGroup";

vi.mock("@/app/lib/random-uuid", () => ({
  createRandomUuid: (): string => "new-port",
}));

function port(
  id: string,
  name: string,
  type: AgentPlanGroupParameter["type"] = "text",
): AgentPlanGroupParameter {
  return {
    id,
    name,
    type,
    description: "",
    isRequired: true,
    defaultValue: null,
  };
}

/** A ticket, a text value, a number value and a variable beside the group. */
const DRAFT: AgentPlanInput = planOf([
  { id: "ticket", type: "task", x: 0, y: 0, taskId: "task-1" },
  {
    id: "note",
    type: "parameter",
    x: 0,
    y: 0,
    name: "Note",
    format: "string",
    value: { type: "text", text: "kept" },
  },
  {
    id: "limit",
    type: "parameter",
    x: 0,
    y: 0,
    name: "Limit",
    format: "number",
    value: { type: "number", number: 2 },
  },
  { id: "variable", type: "variable", x: 0, y: 0, name: "Var" },
]);

function portGroup(overrides: Partial<AgentPlanGroup> = {}): AgentPlanGroup {
  return sessionGroup({
    parameters: [port("p1", "common"), port("p2", "ticket", "ticket")],
    bindings: { common: { kind: "source", nodeId: "note" } },
    steps: [
      agentNode("m1", "codex", {
        bindings: {
          input1: { kind: "source", nodeId: "p1" },
          other: { kind: "literal", value: null },
        },
      }),
      agentNode("m2", "codex", {
        configuration: ownCopy("Pinned", 1),
        bindings: { copy1: { kind: "source", nodeId: "p1" } },
      }),
    ],
    ...overrides,
  });
}

function renderPorts(
  group: AgentPlanGroup,
  disabled = false,
): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  renderTranslated(
    <PlanGroupParameters
      group={group}
      draft={DRAFT}
      sources={GROUP_SOURCES}
      onChange={onChange}
      disabled={disabled}
    />,
  );
  return onChange;
}

function rename(index: number, name: string): void {
  const field = screen.getAllByRole("textbox", {
    name: i18n.t("plans.groups.portName"),
  })[index];
  if (!field) throw new Error("Missing port name");
  fireEvent.change(field, { target: { value: name } });
}

async function choose(label: string, option: string): Promise<void> {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

it("lists each legacy port with the members that read it", () => {
  renderPorts(portGroup());
  expect(screen.getByText(/^common →/).textContent).toBe(
    "common → codex.input1, Pinned.copy1",
  );
  expect(screen.getByText(/^ticket →/).textContent).toBe("ticket → —");
});

it("moves the external binding along when a port is renamed", () => {
  const onChange = renderPorts(portGroup());
  rename(0, "renamed");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      bindings: { renamed: { kind: "source", nodeId: "note" } },
      parameters: [port("p1", "renamed"), port("p2", "ticket", "ticket")],
    }),
  );
  // An unbound port keeps the bindings as they are.
  rename(1, "case");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      bindings: { common: { kind: "source", nodeId: "note" } },
      parameters: [port("p1", "common"), port("p2", "case", "ticket")],
    }),
  );
});

it("refuses a duplicate port name and keeps a binding that already uses the new name", () => {
  const onChange = renderPorts(
    portGroup({
      bindings: {
        common: { kind: "source", nodeId: "note" },
        stale: { kind: "source", nodeId: "variable" },
      },
    }),
  );
  rename(0, "ticket");
  expect(onChange).not.toHaveBeenCalled();
  rename(0, "stale");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      bindings: {
        common: { kind: "source", nodeId: "note" },
        stale: { kind: "source", nodeId: "variable" },
      },
      parameters: [port("p1", "stale"), port("p2", "ticket", "ticket")],
    }),
  );
});

it("changes a port's type and requirement and clears its default", async () => {
  const onChange = renderPorts(
    portGroup({
      parameters: [
        { ...port("p1", "common"), defaultValue: { type: "text", text: "x" } },
      ],
    }),
  );
  await choose(i18n.t("plans.groups.portType"), "number");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      parameters: [{ ...port("p1", "common"), type: "number" }],
    }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: i18n.t("plans.groups.required") }),
  );
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      parameters: [
        {
          ...port("p1", "common"),
          defaultValue: { type: "text", text: "x" },
          isRequired: false,
        },
      ],
    }),
  );
});

it("adds a numbered text port and removes a port with its binding", () => {
  const onChange = renderPorts(portGroup());
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.groups.addPort") }),
  );
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      parameters: [
        port("p1", "common"),
        port("p2", "ticket", "ticket"),
        port("new-port", "parameter3"),
      ],
    }),
  );
  const [removeCommon] = screen.getAllByRole("button", {
    name: i18n.t("plans.groups.removePort"),
  });
  if (!removeCommon) throw new Error("Missing port removal");
  fireEvent.click(removeCommon);
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      bindings: {},
      parameters: [port("p2", "ticket", "ticket")],
    }),
  );
});

it("offers only sources of the port's type and keeps a missing source visible", async () => {
  const onChange = renderPorts(
    portGroup({
      bindings: {
        common: { kind: "source", nodeId: "gone" },
        ticket: { kind: "result", stepId: "m1" },
      },
    }),
  );
  const textSource = i18n.t("plans.groups.externalSource", { name: "common" });
  const ticketSource = i18n.t("plans.groups.externalSource", {
    name: "ticket",
  });
  expect(screen.getByRole("combobox", { name: textSource }).textContent).toBe(
    "gone",
  );
  expect(screen.getByRole("combobox", { name: ticketSource }).textContent).toBe(
    i18n.t("plans.useDefault"),
  );
  fireEvent.keyDown(screen.getByRole("combobox", { name: textSource }), {
    key: "Enter",
  });
  expect(
    (await screen.findAllByRole("option")).map((option) => option.textContent),
  ).toEqual([i18n.t("plans.useDefault"), "Note", "Var", "gone"]);
  fireEvent.click(screen.getByRole("option", { name: "Var" }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      bindings: {
        ticket: { kind: "result", stepId: "m1" },
        common: { kind: "source", nodeId: "variable" },
      },
    }),
  );
  await choose(ticketSource, "SYN-1: Open work");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      bindings: {
        common: { kind: "source", nodeId: "gone" },
        ticket: { kind: "source", nodeId: "ticket" },
      },
    }),
  );
});

it("unbinds a port when its default is chosen", async () => {
  const onChange = renderPorts(portGroup());
  await choose(
    i18n.t("plans.groups.externalSource", { name: "common" }),
    i18n.t("plans.useDefault"),
  );
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ bindings: {} }),
  );
});

it("locks every port control while editing is disabled", () => {
  renderPorts(portGroup(), true);
  const controls = [
    ...screen.getAllByRole("combobox"),
    ...screen.getAllByRole("textbox"),
    ...screen.getAllByRole("checkbox"),
    ...screen.getAllByRole("button"),
  ];
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls)
    expect(control.matches(":disabled")).toBe(true);
});
