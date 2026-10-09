// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TicketParentField } from "@/app/components/tasks/hierarchy/ticket-parent-field";
import {
  countAll,
  describeCounts,
} from "@/app/components/tasks/lifecycle/child-handling-fields";
import { TicketAccessProvider } from "@/app/components/tasks/ticket-access";
import { TicketLifecycleControls } from "@/app/components/tasks/ticket-lifecycle-controls";
import { TicketChildrenSection } from "@/app/components/tasks/ticket/ticket-children-section";
import { TicketCollapsible } from "@/app/components/tasks/ticket/ticket-collapsible";
import { createI18n } from "@/app/lib/i18n";
import { WORK_ITEM_TYPE } from "@/definition/Task";
import { LANGUAGE } from "@/language/Language";

import { createWorkItem } from "../helpers/factories";

import type { TicketAccess } from "@/app/components/tasks/ticket-access";
import type {
  WorkItemDescendants,
  WorkItemTypeCounts,
} from "@/definition/Task";

const NONE: WorkItemTypeCounts = {
  epic: 0,
  initiative: 0,
  subtask: 0,
  task: 0,
};

const ACCESS: TicketAccess = {
  assigneeGroupIdsByProject: {},
  assigneeGroups: [],
  canDelete: true,
  canWrite: true,
  departments: [],
  projects: [],
};

let submissions: Record<string, FormDataEntryValue>[] = [];
let answer: unknown = { intent: "change-parent", ok: true };

function renderWithRouter(
  element: React.ReactElement,
  access: TicketAccess = ACCESS,
): void {
  const router = createMemoryRouter(
    [
      {
        async action({ request }) {
          submissions.push(Object.fromEntries(await request.formData()));

          return { intent: "archive-task", ok: true };
        },
        element,
        path: "/",
      },
      {
        async action({ request }) {
          submissions.push(Object.fromEntries(await request.formData()));

          return answer;
        },
        path: "/aufgaben",
      },
    ],
    { initialEntries: ["/"] },
  );

  render(
    <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
      <TicketAccessProvider value={access}>
        <RouterProvider router={router} />
      </TicketAccessProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  submissions = [];
  answer = { intent: "change-parent", ok: true };
});

describe("child handling", () => {
  it("counts and names the descendants per level", () => {
    const i18n = createI18n(LANGUAGE.GERMAN);
    const counts = { epic: 2, initiative: 0, subtask: 1, task: 5 };

    expect(countAll(counts)).toBe(8);
    expect(describeCounts(counts, i18n.t)).toBe("2 Epics, 5 Tasks, 1 Subtask");
    expect(describeCounts(NONE, i18n.t)).toBe("");
  });

  it("archives an epic with its children or keeps them without a parent", async () => {
    const descendants: WorkItemDescendants = {
      active: { ...NONE, subtask: 3, task: 2 },
      all: { ...NONE, subtask: 3, task: 4 },
    };

    renderWithRouter(
      <TicketLifecycleControls
        descendants={descendants}
        isArchiving={false}
        ticket={createWorkItem({ key: "PAGE-2", type: WORK_ITEM_TYPE.EPIC })}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Archivieren" }));
    let dialog = await screen.findByRole("dialog", {
      name: "PAGE-2 archivieren?",
    });

    expect(
      within(dialog).getByText("Betroffen sind außerdem: 2 Tasks, 3 Subtasks."),
    ).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Archivieren" }),
    );
    await waitFor(() =>
      expect(submissions.at(-1)).toEqual({
        children: "include",
        id: "item-1",
        intent: "archive-task",
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Archivieren" }));
    dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("radio", {
        name: "Untergeordnete Einträge behalten (sie verlieren nur diese Zuordnung)",
      }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Archivieren" }),
    );
    await waitFor(() =>
      expect(submissions.at(-1)).toMatchObject({ children: "keep" }),
    );
  });

  it("archives tasks with their subtasks and leaves without children alone", async () => {
    renderWithRouter(
      <TicketLifecycleControls
        descendants={{ active: { ...NONE, subtask: 1 }, all: NONE }}
        isArchiving={false}
        ticket={createWorkItem({ key: "PAGE-3" })}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Archivieren" }));
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByText(
        "Subtasks gehören zu ihrem Task und werden mitarchiviert.",
      ),
    ).toBeVisible();
    expect(within(dialog).queryByRole("radio")).not.toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Abbrechen" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("names deletions with unknown and with no descendants", async () => {
    renderWithRouter(
      <TicketLifecycleControls
        descendants={null}
        isArchiving
        ticket={createWorkItem({ type: WORK_ITEM_TYPE.SUBTASK })}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Wird archiviert …" }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Endgültig löschen" }),
    );

    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByText("Es gibt keine untergeordneten Einträge."),
    ).toBeVisible();
    expect(dialog.querySelector('input[name="children"]')).toHaveAttribute(
      "value",
      "include",
    );
  });

  it("deletes an initiative while keeping its epics", async () => {
    renderWithRouter(
      <TicketLifecycleControls
        descendants={{ active: NONE, all: { ...NONE, epic: 1 } }}
        isArchiving={false}
        ticket={createWorkItem({ type: WORK_ITEM_TYPE.INITIATIVE })}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Endgültig löschen" }),
    );
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByText("Betroffen sind außerdem: 1 Epic."),
    ).toBeVisible();
    expect(within(dialog).getAllByRole("radio")).toHaveLength(2);
  });
});

describe("TicketParentField", () => {
  const epic = createWorkItem({
    id: "epic-1",
    key: "PAGE-2",
    title: "Login",
    type: WORK_ITEM_TYPE.EPIC,
  });
  const candidates = [
    epic,
    createWorkItem({
      archivedAt: "2026-10-01",
      id: "epic-old",
      key: "PAGE-8",
      title: "Alt",
      type: WORK_ITEM_TYPE.EPIC,
    }),
    createWorkItem({
      id: "epic-foreign",
      key: "ANI-1",
      projectId: "project-2",
      title: "Fremd",
      type: WORK_ITEM_TYPE.EPIC,
    }),
    createWorkItem({ id: "task-2", key: "PAGE-9", title: "Aufgabe" }),
  ];

  it("offers active parents of the level above in the same project", async () => {
    const onOpenTicket = vi.fn();

    renderWithRouter(
      <TicketParentField
        isDisabled={false}
        onOpenTicket={onOpenTicket}
        ticket={createWorkItem({ parentId: null, parentKey: null })}
        workItems={candidates}
      />,
    );

    await userEvent.click(screen.getByLabelText("Epic"));

    expect(
      (await screen.findAllByRole("option")).map(
        (option) => option.textContent,
      ),
    ).toEqual(["Keine Zuordnung", "PAGE-2: Login"]);
    await userEvent.click(
      screen.getByRole("option", { name: "PAGE-2: Login" }),
    );
    await waitFor(() =>
      expect(submissions.at(-1)).toEqual({
        id: "item-1",
        intent: "change-parent",
        parentId: "epic-1",
      }),
    );
    expect(onOpenTicket).not.toHaveBeenCalled();
  });

  it("names a refused change next to the field", async () => {
    answer = { error: "parentArchived", intent: "change-parent", ok: false };
    renderWithRouter(
      <TicketParentField
        isDisabled={false}
        onOpenTicket={vi.fn()}
        ticket={createWorkItem({ parentId: null, parentKey: null })}
        workItems={candidates}
      />,
    );

    await userEvent.click(screen.getByLabelText("Epic"));
    await userEvent.click(
      await screen.findByRole("option", { name: "PAGE-2: Login" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Der gewählte übergeordnete Eintrag ist archiviert.",
    );
  });

  it("shows unknown refusals by their code", async () => {
    answer = { error: "somethingNew", ok: false };
    renderWithRouter(
      <TicketParentField
        isDisabled={false}
        onOpenTicket={vi.fn()}
        ticket={createWorkItem({ parentId: null, parentKey: null })}
        workItems={candidates}
      />,
    );

    await userEvent.click(screen.getByLabelText("Epic"));
    await userEvent.click(
      await screen.findByRole("option", { name: "PAGE-2: Login" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("somethingNew");
  });

  it("requires a task for subtasks and has nothing for initiatives", async () => {
    const onOpenTicket = vi.fn();

    renderWithRouter(
      <>
        <TicketParentField
          isDisabled
          onOpenTicket={onOpenTicket}
          ticket={createWorkItem({
            parentId: "task-2",
            parentKey: "PAGE-9",
            type: WORK_ITEM_TYPE.SUBTASK,
          })}
          workItems={candidates}
        />
        <TicketParentField
          isDisabled={false}
          onOpenTicket={onOpenTicket}
          ticket={createWorkItem({ type: WORK_ITEM_TYPE.INITIATIVE })}
          workItems={candidates}
        />
      </>,
    );

    expect(screen.getByLabelText("Task")).toHaveTextContent("PAGE-9: Aufgabe");
    expect(screen.getByLabelText("Task")).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "PAGE-9 öffnen" }),
    );
    expect(onOpenTicket).toHaveBeenCalledWith("PAGE-9");
    expect(screen.queryByLabelText("Initiative")).not.toBeInTheDocument();
  });

  it("only shows the parent to people without the right to write", () => {
    renderWithRouter(
      <TicketParentField
        isDisabled={false}
        onOpenTicket={vi.fn()}
        ticket={createWorkItem({ parentId: "epic-1", parentKey: "PAGE-2" })}
        workItems={candidates}
      />,
      { ...ACCESS, canWrite: false },
    );

    expect(screen.getByLabelText("Epic")).toBeDisabled();
    expect(screen.getByRole("button", { name: "PAGE-2 öffnen" })).toBeEnabled();
  });

  it("tells while the change is saved", async () => {
    let release: (value: unknown) => void = () => undefined;

    answer = new Promise((resolve) => {
      release = resolve;
    });
    renderWithRouter(
      <TicketParentField
        isDisabled={false}
        onOpenTicket={vi.fn()}
        ticket={createWorkItem({ parentId: null, parentKey: null })}
        workItems={candidates}
      />,
    );

    await userEvent.click(screen.getByLabelText("Epic"));
    await userEvent.click(
      await screen.findByRole("option", { name: "PAGE-2: Login" }),
    );

    expect(await screen.findByText("Wird zugeordnet …")).toBeVisible();
    release({ ok: true });
    await waitFor(() =>
      expect(screen.queryByText("Wird zugeordnet …")).not.toBeInTheDocument(),
    );
  });
});

describe("TicketChildrenSection and TicketCollapsible", () => {
  it("lists children as links and adds one of the level below", async () => {
    const onCreateChild = vi.fn();

    renderWithRouter(
      <TicketChildrenSection
        canAdd
        hrefOf={(key) => `/aufgaben/${key}?from=list`}
        items={[createWorkItem({ key: "PAGE-5", title: "Kind" })]}
        onCreateChild={onCreateChild}
        ticket={createWorkItem({ type: WORK_ITEM_TYPE.EPIC })}
      />,
    );

    expect(
      screen.getByRole("heading", { name: /Enthaltene Tasks/ }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: /Kind/ })).toHaveAttribute(
      "href",
      "/aufgaben/PAGE-5?from=list",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Task hinzufügen" }),
    );
    expect(onCreateChild).toHaveBeenCalled();
  });

  it("shows nothing for subtasks and no add button without the right", () => {
    renderWithRouter(
      <>
        <TicketChildrenSection
          canAdd
          hrefOf={(key) => key}
          items={[]}
          onCreateChild={vi.fn()}
          ticket={createWorkItem({ type: WORK_ITEM_TYPE.SUBTASK })}
        />
        <TicketChildrenSection
          canAdd={false}
          hrefOf={(key) => key}
          items={[]}
          onCreateChild={vi.fn()}
          ticket={createWorkItem({ type: WORK_ITEM_TYPE.INITIATIVE })}
        />
      </>,
    );

    expect(
      screen.getByRole("heading", { name: /Enthaltene Epics/ }),
    ).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Keine untergeordneten Einträge.")).toBeVisible();
  });

  it("opens and closes detail areas", async () => {
    renderWithRouter(
      <TicketCollapsible isInitiallyOpen={false} title="Weitere Aktionen">
        <p>Inhalt</p>
      </TicketCollapsible>,
    );

    const area = screen.getByText("Weitere Aktionen").closest("details");

    expect(area).not.toHaveAttribute("open");
    await userEvent.click(screen.getByText("Weitere Aktionen"));
    expect(area).toHaveAttribute("open");
  });
});
