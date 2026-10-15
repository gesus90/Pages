import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { TaskChecklist } from "@/app/components/tasks/task-checklist";
import { createI18n } from "@/app/lib/i18n";

import type { WorkItemChecklistItem } from "@/definition/Task";

const submit = vi.hoisted(() => vi.fn());
vi.mock("react-router", () => ({ useSubmit: () => submit }));
beforeEach(() => {
  submit.mockReset();
});

const item: WorkItemChecklistItem = {
  id: "criterion",
  workItemId: "ticket",
  title: "Review changes",
  isDone: false,
  sortOrder: 0,
  createdAt: "2026-10-01",
  updatedAt: "2026-10-01",
};

function renderChecklist(
  options: {
    readonly items?: readonly WorkItemChecklistItem[];
    readonly isArchived?: boolean;
    readonly isSubmitting?: boolean;
  } = {},
): void {
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <TaskChecklist workItemId="ticket" items={[]} {...options} />
    </I18nextProvider>,
  );
}

it("shows an empty checklist and refuses whitespace-only additions", () => {
  renderChecklist();
  const input = screen.getByRole("textbox");
  const add = screen.getByRole("button", { name: "Add" });
  expect(add).toHaveProperty("disabled", true);
  fireEvent.change(input, { target: { value: "   " } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(submit).not.toHaveBeenCalled();
  expect(screen.queryByRole("list")).toBeNull();
});

it.each(["button", "Enter"])(
  "adds a trimmed title through %s and clears the input",
  (interaction) => {
    renderChecklist();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "  Check permissions  " } });
    if (interaction === "Enter") fireEvent.keyDown(input, { key: "Enter" });
    else fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(submit).toHaveBeenCalledExactlyOnceWith(
      {
        intent: "checklist-add",
        title: "Check permissions",
        workItemId: "ticket",
      },
      { method: "post" },
    );
    expect(input).toHaveProperty("value", "");
  },
);

it.each([false, true])(
  "submits the opposite checked state (currently %s)",
  (isDone) => {
    renderChecklist({ items: [{ ...item, isDone }] });
    const toggle = screen.getByRole("button", { pressed: isDone });
    fireEvent.click(toggle);
    expect(submit).toHaveBeenCalledExactlyOnceWith(
      {
        intent: "checklist-toggle",
        checklistItemId: "criterion",
        isDone: isDone ? "false" : "true",
      },
      { method: "post" },
    );
    expect(screen.getByText(`${isDone ? 1 : 0} / 1`)).toBeTruthy();
  },
);

it("removes an item by its identifier", () => {
  renderChecklist({ items: [item] });
  fireEvent.click(screen.getByRole("button", { name: /remove/i }));
  expect(submit).toHaveBeenCalledExactlyOnceWith(
    { intent: "checklist-delete", checklistItemId: item.id },
    { method: "post" },
  );
});

it("keeps archived checklist content read-only", () => {
  renderChecklist({ items: [item], isArchived: true });
  expect(screen.getByText(item.title)).toBeTruthy();
  expect(screen.getByRole("button", { pressed: false })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  fireEvent.click(screen.getByRole("button"));
  expect(submit).not.toHaveBeenCalled();
});

it("disables the add button while the route submits", () => {
  renderChecklist({ isSubmitting: true });
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "New item" },
  });
  const add = screen.getByRole("button", { name: "Add" });
  expect(add).toHaveProperty("disabled", true);
  fireEvent.click(add);
  expect(submit).not.toHaveBeenCalled();
});
