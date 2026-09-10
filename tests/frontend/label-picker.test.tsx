// @vitest-environment jsdom
import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";

import { LabelPicker } from "@/app/components/tasks/label-picker";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

import type { ProjectLabel } from "@/definition/Task";

function createLabel(overrides: Partial<ProjectLabel> = {}): ProjectLabel {
  return {
    color: "#3b82f6",
    createdAt: "2026-01-01",
    id: "label-1",
    name: "Feature",
    projectId: "project-1",
    updatedAt: "2026-01-02",
    ...overrides,
  };
}

function renderPicker(
  properties: Partial<Parameters<typeof LabelPicker>[0]> = {},
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
          <LabelPicker
            assignedLabelIds={new Set(["label-1"])}
            isOpen={true}
            labelUsage={{ "label-1": 3 }}
            onOpenChange={vi.fn()}
            projectId="project-1"
            projectLabels={[
              createLabel(),
              createLabel({
                color: "#ef4444",
                id: "label-2",
                name: "Bug",
              }),
            ]}
            workItemId="item-1"
            {...properties}
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

describe("LabelPicker", () => {
  it("assigns and unassigns labels by toggling rows", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];
    renderPicker({}, (fields) => submitted.push(fields));

    await user.click(screen.getByRole("button", { name: "Bug" }));

    expect(submitted.at(-1)).toMatchObject({
      intent: "label-assign",
      labelId: "label-2",
      workItemId: "item-1",
    });

    await user.click(screen.getByRole("button", { name: "Feature" }));

    expect(submitted.at(-1)).toMatchObject({ intent: "label-unassign" });
  });

  it("filters labels through the search field", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.type(screen.getByPlaceholderText("Labels suchen …"), "Bug");

    expect(screen.queryByText("Feature")).not.toBeInTheDocument();
    expect(screen.getByText("Bug")).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText("Labels suchen …"));
    await user.type(screen.getByPlaceholderText("Labels suchen …"), "zzz");

    expect(screen.getByText("Keine Labels gefunden.")).toBeInTheDocument();
  });

  it("creates labels with a curated color", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];
    renderPicker({}, (fields) => submitted.push(fields));

    await user.click(
      screen.getByRole("button", { name: "Neues Label erstellen" }),
    );
    expect(screen.getByRole("button", { name: "Erstellen" })).toBeDisabled();

    await user.type(screen.getByPlaceholderText("z. B. API"), "API");
    await user.click(screen.getByRole("button", { name: "#ef4444" }));
    await user.click(screen.getByRole("button", { name: "Erstellen" }));

    expect(submitted.at(-1)).toMatchObject({
      color: "#ef4444",
      intent: "label-create",
      name: "API",
      projectId: "project-1",
    });
  });

  it("renames labels and cancels editing", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];
    renderPicker({}, (fields) => submitted.push(fields));

    const row = screen.getByText("Feature").closest("li") as HTMLElement;

    await user.click(
      within(row).getByRole("button", { name: "Label bearbeiten Feature" }),
    );
    await user.clear(within(row).getByLabelText("Name"));
    await user.type(within(row).getByLabelText("Name"), "Feature Request");
    await user.click(within(row).getByRole("button", { name: "#a855f7" }));
    await user.click(within(row).getByRole("button", { name: "Speichern" }));

    expect(submitted.at(-1)).toMatchObject({
      color: "#a855f7",
      intent: "label-update",
      labelId: "label-1",
      name: "Feature Request",
    });

    const bugRow = screen.getByText("Bug").closest("li") as HTMLElement;

    await user.click(
      within(bugRow).getByRole("button", { name: "Label bearbeiten Bug" }),
    );
    await user.click(within(bugRow).getByRole("button", { name: "Abbrechen" }));

    expect(within(bugRow).queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("confirms label deletion with usage counts", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];
    renderPicker({}, (fields) => submitted.push(fields));

    const row = screen.getByText("Feature").closest("li") as HTMLElement;

    await user.click(
      within(row).getByRole("button", { name: "Label bearbeiten Feature" }),
    );
    await user.click(
      within(row).getByRole("button", { name: "Label löschen" }),
    );

    expect(
      screen.getByText(/wird von 3 Tickets verwendet/),
    ).toBeInTheDocument();

    const confirm = screen
      .getByText(/wird von 3 Tickets verwendet/)
      .closest("div") as HTMLElement;
    await user.click(
      within(confirm).getByRole("button", { name: "Abbrechen" }),
    );

    expect(
      screen.queryByText(/wird von 3 Tickets verwendet/),
    ).not.toBeInTheDocument();

    await user.click(
      within(row).getByRole("button", { name: "Label löschen" }),
    );
    await user.click(screen.getByRole("button", { name: "Löschen" }));

    expect(submitted.at(-1)).toMatchObject({
      intent: "label-delete",
      labelId: "label-1",
    });
  });

  it("hides the delete confirmation while editing the same label", async () => {
    const user = userEvent.setup();
    renderPicker();

    const row = screen.getByText("Feature").closest("li") as HTMLElement;

    await user.click(
      within(row).getByRole("button", { name: "Label bearbeiten Feature" }),
    );
    await user.click(
      within(row).getByRole("button", { name: "Label löschen" }),
    );

    expect(
      screen.getByText(/wird von 3 Tickets verwendet/),
    ).toBeInTheDocument();

    const cancelButtons = within(row).getAllByRole("button", {
      name: "Abbrechen",
    });
    await user.click(cancelButtons[0]);

    expect(
      screen.queryByText(/wird von 3 Tickets verwendet/),
    ).not.toBeInTheDocument();
    expect(within(row).queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("disables creation while submitting", async () => {
    const user = userEvent.setup();
    renderPicker({ isSubmitting: true });

    await user.click(
      screen.getByRole("button", { name: "Neues Label erstellen" }),
    );

    expect(screen.getByRole("button", { name: "Erstellen" })).toBeDisabled();
  });

  it("clears the search field via the clear button", async () => {
    const user = userEvent.setup();
    renderPicker();

    const search = screen.getByPlaceholderText("Labels suchen …");

    await user.type(search, "Bug");
    expect(
      screen.getByRole("button", { name: "Suche löschen" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Suche löschen" }));

    expect(search).toHaveValue("");
  });

  it("does not submit a new label without a name", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];
    renderPicker({}, (fields) => submitted.push(fields));

    await user.click(
      screen.getByRole("button", { name: "Neues Label erstellen" }),
    );
    await user.click(screen.getByRole("button", { name: "Erstellen" }));

    expect(submitted).toHaveLength(0);
  });

  it("does not save an edit when the new name is empty", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];
    renderPicker({}, (fields) => submitted.push(fields));

    const row = screen.getByText("Feature").closest("li") as HTMLElement;

    await user.click(
      within(row).getByRole("button", { name: "Label bearbeiten Feature" }),
    );
    await user.clear(within(row).getByLabelText("Name"));

    const saveButton = within(row).getByRole("button", { name: "Speichern" });

    expect(saveButton).toBeDisabled();
    expect(submitted).toHaveLength(0);
  });

  it("does not submit a new label without a trimmed name", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];
    renderPicker({}, (fields) => submitted.push(fields));

    await user.click(
      screen.getByRole("button", { name: "Neues Label erstellen" }),
    );

    const saveButton = screen.getByRole("button", { name: "Erstellen" });

    expect(saveButton).toBeDisabled();
    expect(submitted).toHaveLength(0);
  });

  it("cancels creating a new label", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(
      screen.getByRole("button", { name: "Neues Label erstellen" }),
    );

    const input = screen.getByPlaceholderText("z. B. API");

    await user.type(input, "API");

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(
      screen.getByRole("button", { name: "Neues Label erstellen" }),
    ).toBeInTheDocument();
  });

  it("submits a label-assign intent when the catalog gains the pending label", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];

    let addLabel: ((label: ProjectLabel) => void) | null = null;

    function Harness(): React.ReactElement {
      const [labels, setLabels] = React.useState<readonly ProjectLabel[]>([
        createLabel({ id: "label-1", name: "Initial" }),
      ]);

      addLabel = (label: ProjectLabel) => {
        setLabels((current) => [...current, label]);
      };

      return (
        <LabelPicker
          assignedLabelIds={new Set()}
          isOpen={true}
          labelUsage={{}}
          onOpenChange={() => {}}
          projectId="project-1"
          projectLabels={labels}
          workItemId="item-1"
        />
      );
    }

    Harness.displayName = "Harness";

    const router = createMemoryRouter(
      [
        {
          async action({ request }: { request: Request }) {
            const formData = await request.formData();
            const fields: Record<string, string> = {};

            for (const [key, value] of formData.entries()) {
              fields[key] = String(value);
            }

            submitted.push(fields);

            return null;
          },
          element: <Harness />,
          path: "/",
        },
      ],
      { initialEntries: ["/"] },
    );

    const i18n = createI18n(LANGUAGE.GERMAN);

    render(
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: "Neues Label erstellen" }),
    );
    await user.type(screen.getByPlaceholderText("z. B. API"), "Brand-new");
    await user.click(screen.getByRole("button", { name: "Erstellen" }));

    expect(submitted.at(-1)).toMatchObject({
      intent: "label-create",
      name: "Brand-new",
    });

    const addLabelFn = addLabel as ((label: ProjectLabel) => void) | null;

    expect(addLabelFn).not.toBeNull();

    if (addLabelFn === null) {
      throw new Error("Harness did not capture the addLabel callback");
    }

    addLabelFn({
      color: "#f97316",
      createdAt: "2026-09-05",
      id: "label-2",
      name: "Brand-new",
      projectId: "project-1",
      updatedAt: "2026-09-05",
    });

    await waitFor(() =>
      expect(submitted.some((fields) => fields.intent === "label-assign")).toBe(
        true,
      ),
    );
  });

  it("assigns a freshly created label once it appears in the catalog", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];

    const properties = {
      projectLabels: [
        createLabel({
          id: "label-1",
          name: "Initial",
        }),
      ],
    };

    renderPicker(properties, (fields) => submitted.push(fields));

    await user.click(
      screen.getByRole("button", { name: "Neues Label erstellen" }),
    );
    await user.type(screen.getByPlaceholderText("z. B. API"), "Brand-new");
    await user.click(screen.getByRole("button", { name: "Erstellen" }));

    expect(submitted.at(-1)).toMatchObject({
      intent: "label-create",
      name: "Brand-new",
    });
  });

  it("deletes a label after two clicks on the delete button", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];
    renderPicker({}, (fields) => submitted.push(fields));

    const row = screen.getByText("Feature").closest("li") as HTMLElement;

    await user.click(
      within(row).getByRole("button", { name: "Label bearbeiten Feature" }),
    );
    await user.click(
      within(row).getByRole("button", { name: "Label löschen" }),
    );

    expect(
      screen.getByText(/wird von 3 Tickets verwendet/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Löschen" }));

    expect(submitted.at(-1)).toMatchObject({
      intent: "label-delete",
      labelId: "label-1",
    });
  });

  it("clears the pending assign name when the dialog closes", async () => {
    const onOpenChange = vi.fn();

    const i18n = createI18n(LANGUAGE.GERMAN);
    const router = createMemoryRouter(
      [
        {
          element: (
            <LabelPicker
              assignedLabelIds={new Set()}
              isOpen={true}
              labelUsage={{}}
              onOpenChange={onOpenChange}
              projectId="project-1"
              projectLabels={[createLabel()]}
              workItemId="item-1"
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

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes the dialog through onOpenChange and clears pending assigns", () => {
    const onOpenChange = vi.fn();

    const i18n = createI18n(LANGUAGE.GERMAN);
    const router = createMemoryRouter(
      [
        {
          element: (
            <LabelPicker
              assignedLabelIds={new Set()}
              isOpen={true}
              labelUsage={{}}
              onOpenChange={onOpenChange}
              projectId="project-1"
              projectLabels={[createLabel()]}
              workItemId="item-1"
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

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
