import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanValueInput } from "@/app/components/agents/plans/plan-node-card/plan-value-input";

import { SOURCES } from "../../page61-plan-fixture";
import { flowContext, i18n, renderInFlow } from "../plan-flow-fixture";
import { localWorkspace } from "../plan-management/plan-management-fixture";

import type {
  AgentParameterType,
  AgentParameterValue,
} from "@/definition/AgentParameters";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";

interface InputSetup {
  readonly type: AgentParameterType;
  readonly value: AgentParameterValue | null;
  readonly placeholder?: string;
  readonly isJson?: boolean;
  readonly isEmptyAllowed?: boolean;
  readonly hasIssue?: boolean;
  readonly disabled?: boolean;
  readonly workspaces?: readonly AgentWorkspaceChoice[];
}

function renderInput(setup: InputSetup): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  renderInFlow(
    <PlanValueInput
      type={setup.type}
      value={setup.value}
      label="Value"
      placeholder={setup.placeholder}
      isJson={setup.isJson}
      isEmptyAllowed={setup.isEmptyAllowed}
      hasIssue={setup.hasIssue}
      disabled={setup.disabled ?? false}
      onChange={onChange}
    />,
    flowContext({ sources: SOURCES, workspaces: setup.workspaces }),
  );
  return onChange;
}

function input(): HTMLInputElement {
  const element = screen.getByLabelText("Value");
  if (!(element instanceof HTMLInputElement)) throw new Error("No input");
  return element;
}

async function options(): Promise<readonly HTMLElement[]> {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Value" }), {
    key: "Enter",
  });
  await screen.findByRole("listbox");
  return screen.getAllByRole("option");
}

it("edits text and keeps JSON monospaced and an issue marked", () => {
  const onChange = renderInput({
    type: "text",
    value: { type: "text", text: "{}" },
    isJson: true,
    hasIssue: true,
    placeholder: "Typed value",
  });
  expect(input().value).toBe("{}");
  expect(input().title).toBe("{}");
  expect(input().placeholder).toBe("Typed value");
  expect(input().maxLength).toBe(200000);
  expect(input().className).toContain("font-mono");
  expect(input().className).toContain("border-destructive");
  expect(input().getAttribute("aria-invalid")).toBe("true");
  fireEvent.change(input(), { target: { value: '{"a":1}' } });
  expect(onChange).toHaveBeenCalledWith({ type: "text", text: '{"a":1}' });
});

it("edits a wiki page identifier as a short text", () => {
  const onChange = renderInput({
    type: "wiki",
    value: { type: "wiki", pageId: "page-1" },
  });
  expect(input().value).toBe("page-1");
  expect(input().maxLength).toBe(100);
  expect(input().className).not.toContain("font-mono");
  fireEvent.change(input(), { target: { value: "page-2" } });
  expect(onChange).toHaveBeenCalledWith({ type: "wiki", pageId: "page-2" });
});

it("leaves a text field empty for a value of another type", () => {
  renderInput({ type: "text", value: { type: "number", number: 3 } });
  expect(input().value).toBe("");
  expect(input().title).toBe("");
});

it("edits a finite number and shows an unreadable one as empty", () => {
  const onChange = renderInput({
    type: "number",
    value: { type: "number", number: 4 },
    hasIssue: true,
  });
  expect(input().value).toBe("4");
  expect(input().className).toContain("border-destructive");
  fireEvent.change(input(), { target: { value: "7.5" } });
  expect(onChange).toHaveBeenCalledWith({ type: "number", number: 7.5 });
});

it("shows no number for an empty or non-number value", () => {
  renderInput({
    type: "number",
    value: { type: "number", number: Number.NaN },
  });
  expect(input().value).toBe("");
});

it("shows no number for a value of another type", () => {
  renderInput({ type: "number", value: null });
  expect(input().value).toBe("");
});

it("chooses a ticket of the project and keeps a gone ticket selected as unavailable", async () => {
  const onChange = renderInput({
    type: "ticket",
    value: { type: "ticket", ticketId: "gone" },
    hasIssue: true,
  });
  const combobox = screen.getByRole("combobox", { name: "Value" });
  expect(combobox.textContent).toBe(i18n.t("plans.ticketUnavailable"));
  expect(combobox.className).toContain("border-destructive");
  const listed = await options();
  expect(listed.map((option) => option.textContent)).toEqual([
    "SYN-1: Open work",
    "SYN-2: Ongoing",
    "SYN-3: Finished",
    "SYN-4: Next work",
    i18n.t("plans.ticketUnavailable"),
  ]);
  fireEvent.click(screen.getByRole("option", { name: "SYN-2: Ongoing" }));
  expect(onChange).toHaveBeenCalledWith({ type: "ticket", ticketId: "2" });
});

it("offers an empty ticket choice with the placeholder while none is chosen or emptying is allowed", async () => {
  const onChange = renderInput({
    type: "ticket",
    value: { type: "ticket", ticketId: "1" },
    isEmptyAllowed: true,
    placeholder: "Default ticket",
  });
  const listed = await options();
  expect(listed[0]?.textContent).toBe("Default ticket");
  fireEvent.click(screen.getByRole("option", { name: "Default ticket" }));
  expect(onChange).toHaveBeenCalledWith({ type: "ticket", ticketId: "" });
});

it("names the empty ticket choice without a placeholder", () => {
  renderInput({ type: "ticket", value: null, disabled: true });
  const combobox = screen.getByRole("combobox", { name: "Value" });
  expect(combobox.textContent).toBe(i18n.t("plans.chooseTicket"));
  expect(combobox).toHaveProperty("disabled", true);
});

it("chooses a usable workspace, disables the others and keeps a gone workspace as unavailable", async () => {
  const onChange = renderInput({
    type: "workspace",
    value: { type: "workspace", workspaceId: "gone" },
    workspaces: [
      localWorkspace("one", "project"),
      localWorkspace("locked", "project", { isUsable: false }),
    ],
  });
  const listed = await options();
  expect(listed.map((option) => option.textContent)).toEqual([
    "Workspace one",
    "Workspace locked",
    i18n.t("plans.workspaceUnavailable"),
  ]);
  expect(listed[1]?.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByRole("option", { name: "Workspace one" }));
  expect(onChange).toHaveBeenCalledWith({
    type: "workspace",
    workspaceId: "one",
  });
});

it("asks for a workspace when the canvas offers none", async () => {
  renderInput({ type: "workspace", value: null });
  expect(screen.getByRole("combobox", { name: "Value" }).textContent).toBe(
    i18n.t("plans.chooseWorkspace"),
  );
  expect(await options()).toHaveLength(1);
});

it("asks for a workspace with the given placeholder", () => {
  renderInput({
    type: "workspace",
    value: { type: "text", text: "x" },
    placeholder: "Inherited workspace",
  });
  expect(screen.getByRole("combobox", { name: "Value" }).textContent).toBe(
    "Inherited workspace",
  );
});
