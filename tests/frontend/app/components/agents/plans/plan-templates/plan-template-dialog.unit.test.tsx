import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { PlanTemplateDialog } from "@/app/components/agents/plans/plan-templates/plan-template-dialog";
import { savePlanTemplate } from "@/app/components/agents/plans/plan-templates/plan-template-requests";
import { createI18n } from "@/app/lib/i18n";

import { EMPTY_SOURCES, planOf } from "../plan-flow-fixture";
import { parameterNode, savedTemplate } from "./template-fixture";

import type { RenderResult } from "@testing-library/react";
import type { PlanTemplateResult } from "@/app/components/agents/plans/plan-templates/plan-template-requests";
import type {
  AgentPlanNodeTemplate,
  AgentPlanTemplateNode,
} from "@/definition/AgentPlanNodeTemplate";

vi.mock(
  "@/app/components/agents/plans/plan-templates/plan-template-requests",
  () => ({ savePlanTemplate: vi.fn() }),
);

const i18n = createI18n("en");
const TARGET = { planId: "plan", workspaceId: "workspace" };

interface Shown {
  readonly view: RenderResult;
  readonly onSaved: ReturnType<typeof vi.fn>;
  readonly onClose: ReturnType<typeof vi.fn>;
}

function show(node: AgentPlanTemplateNode = parameterNode()): Shown {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <button type="button" data-plan-handle={node.id}>
        Node handle
      </button>
      <PlanTemplateDialog
        node={node}
        target={TARGET}
        context={{
          draft: planOf([node]),
          sources: EMPTY_SOURCES,
          workspaces: [],
          translate: i18n.getFixedT("en"),
        }}
        onSaved={onSaved}
        onClose={onClose}
      />
    </I18nextProvider>,
  );
  return { view, onSaved, onClose };
}

function nameField(): HTMLInputElement {
  const field = screen.getByLabelText("Name");
  if (!(field instanceof HTMLInputElement)) throw new Error("Expected input");
  return field;
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: "Save" });
}

/** A save answer the test resolves when it wants. */
function heldSave(): (
  result: PlanTemplateResult<AgentPlanNodeTemplate>,
) => void {
  let answer: (
    result: PlanTemplateResult<AgentPlanNodeTemplate>,
  ) => void = () => undefined;
  vi.mocked(savePlanTemplate).mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  return (result) => answer(result);
}

beforeEach(() => {
  vi.resetAllMocks();
  // jsdom has no CSS namespace; node identifiers here need no escaping.
  vi.stubGlobal("CSS", { escape: (value: string) => value });
});

it("suggests the node's name with the caret after it and describes the node", () => {
  show();
  expect(screen.getByRole("dialog", { name: "Save as template" })).toBeTruthy();
  expect(
    screen.getByText("Reuse the current parameter configuration later."),
  ).toBeTruthy();
  const field = nameField();
  expect(field.value).toBe("topic");
  expect(document.activeElement).toBe(field);
  expect(field.selectionStart).toBe(5);
  expect(field.selectionEnd).toBe(5);
  expect(field.getAttribute("aria-invalid")).toBe("false");
});

it("refuses an empty name until one is entered", () => {
  show();
  fireEvent.change(nameField(), { target: { value: "  " } });
  expect(screen.getByRole("alert").textContent).toBe(
    "Enter a name for the template.",
  );
  expect(nameField().getAttribute("aria-invalid")).toBe("true");
  expect(saveButton().hasAttribute("disabled")).toBe(true);
  const form = nameField().closest("form");
  if (!form) throw new Error("Expected the form");
  fireEvent.submit(form);
  expect(savePlanTemplate).not.toHaveBeenCalled();
});

it("saves under the edited name once and hands the template on", async () => {
  const answer = heldSave();
  const node = parameterNode();
  const { onSaved, onClose, view } = show(node);
  fireEvent.change(nameField(), { target: { value: "Weekly topic" } });
  fireEvent.click(saveButton());
  expect(savePlanTemplate).toHaveBeenCalledWith(TARGET, {
    name: "Weekly topic",
    node,
  });
  expect(screen.getByRole("button", { name: "Saving …" })).toBeTruthy();
  expect(nameField().disabled).toBe(true);
  expect(
    screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled"),
  ).toBe(true);
  const form = nameField().closest("form");
  if (!form) throw new Error("Expected the form");
  fireEvent.submit(form);
  fireEvent.keyDown(nameField(), { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
  expect(savePlanTemplate).toHaveBeenCalledOnce();
  const template = savedTemplate(node, { name: "Weekly topic" });
  await act(async () => {
    answer({ ok: true, value: template });
    await Promise.resolve();
  });
  expect(onSaved).toHaveBeenCalledWith(template);
  // The list focuses the saved template; the node handle stays unfocused.
  view.unmount();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(document.activeElement).toBe(document.body);
});

it("keeps the dialog open with the reason of a refused save until the name changes", async () => {
  vi.mocked(savePlanTemplate).mockResolvedValueOnce({
    ok: false,
    error: "name_taken",
  });
  const { onSaved } = show();
  fireEvent.click(saveButton());
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole("alert").textContent).toBe(
    `Not saved: ${i18n.t("settings.agents.error.name_taken")}`,
  );
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.change(nameField(), { target: { value: "Other" } });
  expect(screen.getByRole("alert").textContent).toBe("");
  fireEvent.change(nameField(), { target: { value: "Other topic" } });
  expect(nameField().value).toBe("Other topic");
});

it("closes without saving and returns the focus to the node", () => {
  const { onClose, view } = show();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledOnce();
  fireEvent.keyDown(nameField(), { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(savePlanTemplate).not.toHaveBeenCalled();
});

it("puts the focus back on the node handle when the dialog goes away unsaved", async () => {
  const onClose = vi.fn();
  const node = parameterNode();
  const context = {
    draft: planOf([node]),
    sources: EMPTY_SOURCES,
    workspaces: [],
    translate: i18n.getFixedT("en"),
  };
  const dialog = (isOpen: boolean): React.ReactElement => (
    <I18nextProvider i18n={i18n}>
      <button type="button" data-plan-handle={node.id}>
        Node handle
      </button>
      {isOpen ? (
        <PlanTemplateDialog
          node={node}
          target={TARGET}
          context={context}
          onSaved={vi.fn()}
          onClose={onClose}
        />
      ) : null}
    </I18nextProvider>
  );
  const view = render(dialog(true));
  view.rerender(dialog(false));
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Node handle" }),
    ),
  );
});
