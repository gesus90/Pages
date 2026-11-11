import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { AgentTemplateList } from "@/app/components/users/agents/agent-template-list";
import { createI18n } from "@/app/lib/i18n";

import { resetRouter, router, submittedFields } from "./agent-router-mock";

import type { AgentInstructionTemplate } from "@/definition/AgentInstructionTemplate";

vi.mock("react-router", async (importOriginal) => {
  const { withMockedRouter } = await import("./agent-router-mock");
  return withMockedRouter(await importOriginal<object>());
});

const i18n = createI18n("de");

function template(
  id: string,
  overrides: Partial<AgentInstructionTemplate> = {},
): AgentInstructionTemplate {
  return {
    id,
    name: `Template ${id}`,
    description: `About ${id}`,
    content: `Content of ${id}`,
    isDefault: false,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    ...overrides,
  };
}

const TEMPLATES = [template("a", { isDefault: true }), template("b")];

function renderList(
  props: {
    readonly templates?: readonly AgentInstructionTemplate[];
    readonly canManage?: boolean;
    readonly document?: string;
    readonly isDisabled?: boolean;
  } = {},
): {
  readonly onApply: ReturnType<typeof vi.fn<(content: string) => void>>;
  readonly rerender: () => void;
} {
  const onApply = vi.fn<(content: string) => void>();
  const ui = (): React.ReactElement => (
    <I18nextProvider i18n={i18n}>
      <AgentTemplateList
        templates={{
          templates: props.templates ?? TEMPLATES,
          canManage: props.canManage ?? true,
        }}
        document={props.document ?? ""}
        onApply={onApply}
        isDisabled={props.isDisabled ?? false}
      />
    </I18nextProvider>
  );
  const view = render(ui());
  return { onApply, rerender: () => view.rerender(ui()) };
}

function label(key: string, values?: Record<string, string>): string {
  return i18n.t(`agentEmployees.templateList.${key}`, values);
}

beforeEach(resetRouter);

it("says so when no template exists", () => {
  renderList({ templates: [] });
  expect(screen.getByText(label("empty"))).toBeDefined();
  expect(screen.queryByRole("list")).toBeNull();
});

it("lists the templates with description and a badge on the defaults", () => {
  renderList();
  const items = screen.getAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(within(items[0]).getByText(label("default"))).toBeDefined();
  expect(within(items[0]).getByText("About a")).toBeDefined();
  expect(within(items[1]).queryByText(label("default"))).toBeNull();
});

it("hides the management buttons from people who may not manage", () => {
  renderList({ canManage: false });
  expect(screen.queryByText(label("create"))).toBeNull();
  expect(screen.queryByText(label("saveFromDocument"))).toBeNull();
  expect(screen.queryByText(label("edit"))).toBeNull();
  expect(screen.queryByText(label("remove"))).toBeNull();
});

it("fills an empty AGENT.md at once and marks the template as chosen", () => {
  const { onApply } = renderList();
  const pick = screen.getByRole("button", { name: /Template b/u });
  expect(pick.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(pick);
  expect(onApply).toHaveBeenCalledWith("Content of b");
  expect(pick.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText(label("selected"))).toBeDefined();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("asks before replacing text and keeps it when cancelled", () => {
  const { onApply } = renderList({ document: "My own text" });
  fireEvent.click(screen.getByRole("button", { name: /Template b/u }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(label("replaceConfirm.title"))).toBeDefined();
  expect(
    within(dialog).getByText(
      label("replaceConfirm.description", { name: "Template b" }),
    ),
  ).toBeDefined();
  fireEvent.click(within(dialog).getByText(label("editor.cancel")));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(onApply).not.toHaveBeenCalled();
});

it("replaces the text after the confirmation", () => {
  const { onApply } = renderList({ document: "My own text" });
  fireEvent.click(screen.getByRole("button", { name: /Template b/u }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByText(
      label("replaceConfirm.confirm"),
    ),
  );
  expect(onApply).toHaveBeenCalledWith("Content of b");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText(label("selected"))).toBeDefined();
});

it("locks the picking buttons while the panel is disabled", () => {
  renderList({ isDisabled: true });
  expect(
    screen
      .getByRole("button", { name: /Template b/u })
      .hasAttribute("disabled"),
  ).toBe(true);
});

it("opens an empty editor for a new template", () => {
  renderList({ document: "Some text" });
  fireEvent.click(screen.getByText(label("create")));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(label("editor.createTitle"))).toBeDefined();
  expect(within(dialog).getByLabelText(label("editor.content"))).toHaveProperty(
    "value",
    "",
  );
});

it("saves the current AGENT.md as a template and disables that for blank text", () => {
  renderList({ document: "Some text" });
  fireEvent.click(screen.getByText(label("saveFromDocument")));
  expect(
    within(screen.getByRole("dialog")).getByLabelText(label("editor.content")),
  ).toHaveProperty("value", "Some text");
});

it("cannot save a blank AGENT.md as a template", () => {
  renderList({ document: "  \n " });
  expect(
    screen.getByText(label("saveFromDocument")).closest("button")?.disabled,
  ).toBe(true);
});

it("opens the editor with the stored template to change it", () => {
  renderList();
  fireEvent.click(
    within(
      screen.getByRole("group", {
        name: label("actions", { name: "Template b" }),
      }),
    ).getByText(label("edit")),
  );
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(label("editor.editTitle"))).toBeDefined();
  expect(within(dialog).getByLabelText(label("editor.name"))).toHaveProperty(
    "value",
    "Template b",
  );
  fireEvent.click(within(dialog).getByText(label("editor.cancel")));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("duplicates a template into an editor for a new one named as a copy", () => {
  renderList();
  fireEvent.click(
    within(
      screen.getByRole("group", {
        name: label("actions", { name: "Template b" }),
      }),
    ).getByText(label("duplicate")),
  );
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(label("editor.createTitle"))).toBeDefined();
  expect(within(dialog).getByLabelText(label("editor.name"))).toHaveProperty(
    "value",
    label("copyName", { name: "Template b" }),
  );
  expect(
    within(dialog).getByLabelText(label("editor.description")),
  ).toHaveProperty("value", "About b");
  expect(within(dialog).getByLabelText(label("editor.content"))).toHaveProperty(
    "value",
    "Content of b",
  );
  fireEvent.submit(within(dialog).getByLabelText(label("editor.name")));
  expect(submittedFields(0)).toMatchObject({
    intent: "save-agent-template",
    templateId: "",
  });
});

it("deletes a template only after the confirmation", () => {
  renderList();
  fireEvent.click(
    within(
      screen.getByRole("group", {
        name: label("actions", { name: "Template b" }),
      }),
    ).getByText(label("remove")),
  );
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(label("removeConfirm.title"))).toBeDefined();
  expect(router.submit).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByText(label("removeConfirm.confirm")));
  expect(submittedFields(0)).toEqual({
    intent: "delete-agent-template",
    templateId: "b",
  });
  expect(router.submit.mock.calls[0]?.[1]).toEqual({ method: "post" });
});

it("shows a refused deletion in the dialog", () => {
  router.actionData = {
    ok: false,
    intent: "delete-agent-template",
    error: "forbidden",
  };
  renderList();
  fireEvent.click(
    within(
      screen.getByRole("group", {
        name: label("actions", { name: "Template a" }),
      }),
    ).getByText(label("remove")),
  );
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("alert")).toBeDefined();
});

it("closes the deletion dialog when a new answer reports success", () => {
  const { rerender } = renderList();
  fireEvent.click(
    within(
      screen.getByRole("group", {
        name: label("actions", { name: "Template b" }),
      }),
    ).getByText(label("remove")),
  );
  expect(screen.getByRole("dialog")).toBeDefined();
  router.actionData = { ok: true, intent: "delete-agent-template" };
  rerender();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("marks the confirmation as pending while the deletion is submitted", () => {
  const { rerender } = renderList();
  fireEvent.click(
    within(
      screen.getByRole("group", {
        name: label("actions", { name: "Template b" }),
      }),
    ).getByText(label("remove")),
  );
  const confirm = (): HTMLElement =>
    within(screen.getByRole("dialog")).getByRole("button", {
      name: label("removeConfirm.confirm"),
    });
  expect(confirm().hasAttribute("disabled")).toBe(false);
  router.state = "submitting";
  router.formData = new FormData();
  router.formData.set("intent", "delete-agent-template");
  rerender();
  expect(confirm().hasAttribute("disabled")).toBe(true);
});

it("lists a template without a description by its name alone", () => {
  renderList({ templates: [template("c", { description: "" })] });
  const item = screen.getByRole("listitem");
  expect(within(item).getByText("Template c")).toBeDefined();
  expect(within(item).queryByText("About c")).toBeNull();
});
