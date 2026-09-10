// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";

import { TaskChecklist } from "@/app/components/tasks/task-checklist";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

import type { WorkItemChecklistItem } from "@/definition/Task";

function createItem(
  overrides: Partial<WorkItemChecklistItem> = {},
): WorkItemChecklistItem {
  return {
    createdAt: "2026-01-01",
    id: "item-1",
    isDone: false,
    sortOrder: 1,
    title: "Cover edge cases",
    updatedAt: "2026-01-02",
    workItemId: "ticket-1",
    ...overrides,
  };
}

function renderChecklist(
  properties: {
    readonly items?: readonly WorkItemChecklistItem[];
    readonly isArchived?: boolean;
    readonly isSubmitting?: boolean;
  } = {},
  onAction: (fields: Record<string, string>) => void = () => {},
): void {
  const i18n = createI18n(LANGUAGE.GERMAN);

  const router = createMemoryRouter(
    [
      {
        async action({ request }: { request: Request }) {
          const formData = await request.formData();
          const fields: Record<string, string> = {};

          for (const [key, value] of formData.entries()) {
            fields[key] = String(value);
          }

          onAction(fields);

          return null;
        },
        element: (
          <TaskChecklist
            isArchived={properties.isArchived}
            isSubmitting={properties.isSubmitting}
            items={properties.items ?? []}
            workItemId="ticket-1"
          />
        ),
        path: "/",
      },
    ],
    { initialEntries: ["/"] },
  );

  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("TaskChecklist", () => {
  it("renders the empty-state placeholder when there are no items", () => {
    renderChecklist();

    expect(screen.getByText("Keine")).toBeInTheDocument();
  });

  it("renders the progress bar with the correct counts", () => {
    renderChecklist({
      items: [
        createItem({ id: "a", isDone: true }),
        createItem({ id: "b", isDone: true }),
        createItem({ id: "c", isDone: false }),
      ],
    });

    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("hides the progress bar when no items exist", () => {
    renderChecklist();

    expect(screen.queryByText(/\d+ \/ \d+/)).not.toBeInTheDocument();
  });

  it("toggles an item when its checkbox is clicked", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];

    renderChecklist({ items: [createItem()] }, (fields) =>
      submitted.push(fields),
    );

    await user.click(screen.getByRole("button", { name: "" }));

    expect(submitted.at(-1)).toMatchObject({
      checklistItemId: "item-1",
      intent: "checklist-toggle",
      isDone: "true",
    });
  });

  it("toggles a done item back to not-done", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];

    renderChecklist({ items: [createItem({ isDone: true })] }, (fields) =>
      submitted.push(fields),
    );

    await user.click(screen.getByRole("button", { name: "" }));

    expect(submitted.at(-1)).toMatchObject({ isDone: "false" });
  });

  it("removes an item when the trash icon is clicked", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];

    renderChecklist({ items: [createItem()] }, (fields) =>
      submitted.push(fields),
    );

    await user.click(screen.getByRole("button", { name: "Entfernen" }));

    expect(submitted.at(-1)).toMatchObject({
      checklistItemId: "item-1",
      intent: "checklist-delete",
    });
  });

  it("hides the remove button when the ticket is archived", () => {
    renderChecklist({
      isArchived: true,
      items: [createItem()],
    });

    expect(screen.queryByRole("button", { name: "Entfernen" })).toBeNull();
  });

  it("disables the toggle button when the ticket is archived", () => {
    renderChecklist({
      isArchived: true,
      items: [createItem()],
    });

    expect(screen.getAllByRole("button")[0]).toBeDisabled();
  });

  it("adds a new item via the add button", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];

    renderChecklist({}, (fields) => submitted.push(fields));

    const input = screen.getByPlaceholderText("Neues Kriterium …");

    await user.type(input, "Wire up Webhooks");

    await user.click(screen.getByRole("button", { name: "Hinzufügen" }));

    expect(submitted.at(-1)).toMatchObject({
      intent: "checklist-add",
      title: "Wire up Webhooks",
      workItemId: "ticket-1",
    });

    expect(input).toHaveValue("");
  });

  it("adds a new item when pressing Enter in the input", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];

    renderChecklist({}, (fields) => submitted.push(fields));

    const input = screen.getByPlaceholderText("Neues Kriterium …");

    await user.type(input, "Wire up Webhooks{Enter}");

    expect(submitted.at(-1)).toMatchObject({
      intent: "checklist-add",
      title: "Wire up Webhooks",
    });
  });

  it("does not submit when adding with a blank title", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];

    renderChecklist({}, (fields) => submitted.push(fields));

    const input = screen.getByPlaceholderText("Neues Kriterium …");

    await user.type(input, "   ");

    const addButton = screen.getByRole("button", { name: "Hinzufügen" });

    addButton.removeAttribute("disabled");
    fireEvent.click(addButton);

    expect(submitted).toHaveLength(0);
  });

  it("adds a new item when pressing Enter with a blank title", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];

    renderChecklist({}, (fields) => submitted.push(fields));

    const input = screen.getByPlaceholderText("Neues Kriterium …");

    await user.click(input);
    await user.keyboard("{Enter}");

    expect(submitted).toHaveLength(0);
  });

  it("disables the add button while submitting", () => {
    renderChecklist({ isSubmitting: true });

    expect(screen.getByRole("button", { name: "Hinzufügen" })).toBeDisabled();
  });

  it("disables the add button when the trimmed title is empty", () => {
    renderChecklist();

    expect(screen.getByRole("button", { name: "Hinzufügen" })).toBeDisabled();
  });

  it("hides the add input when the ticket is archived", () => {
    renderChecklist({ isArchived: true });

    expect(
      screen.queryByPlaceholderText("Neues Kriterium …"),
    ).not.toBeInTheDocument();
  });
});
