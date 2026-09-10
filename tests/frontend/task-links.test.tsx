// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";

import { TaskLinks } from "@/app/components/tasks/task-links";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";
import { WORK_ITEM_LINK_TYPE } from "@/definition/Task";

import type { WorkItemDetail, WorkItemLink } from "@/definition/Task";

function createWorkItem(
  overrides: Partial<WorkItemDetail> = {},
): WorkItemDetail {
  return {
    archivedAt: null,
    assigneeId: null,
    assigneeName: null,
    reporterName: null,
    completedAt: null,
    createdAt: "2026-01-01",
    createdBy: "user-1",
    description: "",
    dueAt: null,
    githubConflict: false,
    githubContentHash: null,
    githubIssueNumber: null,
    githubIssueState: null,
    githubIssueUpdatedAt: null,
    githubIssueUrl: null,
    githubLastSyncAt: null,
    githubLastError: null,
    id: "item-1",
    isDone: false,
    key: "PAGE-12",
    milestoneId: null,
    milestoneName: null,
    number: 12,
    parentId: null,
    parentKey: null,
    parentTitle: null,
    priority: "normal",
    progressPercentage: 0,
    projectId: "project-1",
    projectName: "Pages",
    sortOrder: 1,
    startAt: null,
    statusId: "status-todo",
    statusKey: "todo",
    statusName: "To Do",
    subtaskCompleted: 0,
    subtaskTotal: 0,
    title: "Build kanban",
    type: "task",
    updatedAt: "2026-01-02",
    ...overrides,
  };
}

function createLink(overrides: Partial<WorkItemLink> = {}): WorkItemLink {
  return {
    createdAt: "2026-01-01",
    direction: "outgoing",
    id: "link-1",
    linkType: WORK_ITEM_LINK_TYPE.RELATES_TO,
    linkedWorkItemId: "item-2",
    linkedWorkItemIsDone: false,
    linkedWorkItemKey: "PAGE-99",
    linkedWorkItemStatusKey: "todo",
    linkedWorkItemTitle: "Foreign epic",
    ...overrides,
  };
}

function renderLinks(
  properties: Partial<Parameters<typeof TaskLinks>[0]> = {},
  onAction: (fields: Record<string, string>) => void = () => {},
): {
  onSelectTask: ReturnType<typeof vi.fn>;
} {
  const onSelectTask = vi.fn();

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
          <TaskLinks
            currentWorkItemKey="PAGE-12"
            links={[]}
            onSelectTask={onSelectTask}
            workItemId="ticket-1"
            workItems={[
              createWorkItem(),
              createWorkItem({
                archivedAt: null,
                id: "item-2",
                key: "PAGE-99",
                title: "Foreign epic",
              }),
            ]}
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

  return { onSelectTask };
}

describe("TaskLinks", () => {
  it("renders the empty-state placeholder when no links exist", () => {
    renderLinks();

    expect(screen.getByText("Noch keine Verknüpfungen")).toBeInTheDocument();
  });

  it("renders incoming links with the mirrored label", () => {
    renderLinks({
      links: [
        createLink({
          direction: "incoming",
          linkType: WORK_ITEM_LINK_TYPE.BLOCKS,
        }),
      ],
    });

    expect(screen.getByText("Wird blockiert durch")).toBeInTheDocument();
  });

  it("renders outgoing block links with the block label", () => {
    renderLinks({
      links: [
        createLink({
          direction: "outgoing",
          linkType: WORK_ITEM_LINK_TYPE.BLOCKS,
        }),
      ],
    });

    expect(screen.getByText("Blockiert")).toBeInTheDocument();
  });

  it("renders outgoing duplicate links with the duplicate label", () => {
    renderLinks({
      links: [
        createLink({
          direction: "outgoing",
          linkType: WORK_ITEM_LINK_TYPE.DUPLICATES,
        }),
      ],
    });

    expect(screen.getByText("Dupliziert")).toBeInTheDocument();
  });

  it("renders incoming duplicate links with the mirrored label", () => {
    renderLinks({
      links: [
        createLink({
          direction: "incoming",
          linkType: WORK_ITEM_LINK_TYPE.DUPLICATES,
        }),
      ],
    });

    expect(screen.getByText("Dupliziert von")).toBeInTheDocument();
  });

  it("navigates to the linked work item on click", async () => {
    const user = userEvent.setup();
    const { onSelectTask } = renderLinks({
      links: [createLink({ linkedWorkItemKey: "PAGE-99" })],
    });

    await user.click(screen.getByRole("button", { name: /PAGE-99/ }));

    expect(onSelectTask).toHaveBeenCalledWith("PAGE-99");
  });

  it("removes a link through the remove button", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];

    renderLinks(
      { links: [createLink({ id: "link-1", linkedWorkItemKey: "PAGE-99" })] },
      (fields) => submitted.push(fields),
    );

    await user.click(screen.getByRole("button", { name: "Entfernen" }));

    expect(submitted.at(-1)).toMatchObject({
      intent: "link-remove",
      linkId: "link-1",
      workItemId: "ticket-1",
    });
  });

  it("hides the remove button for archived work items", () => {
    renderLinks({
      isArchived: true,
      links: [createLink()],
    });

    expect(screen.queryByRole("button", { name: "Entfernen" })).toBeNull();
  });

  it("shows the check icon when the linked work item is done", () => {
    renderLinks({
      links: [createLink({ linkedWorkItemIsDone: true })],
    });

    expect(
      screen.getAllByRole("button", { name: /PAGE-99/ }).length,
    ).toBeGreaterThan(0);
  });

  it("hides the add form when there are no eligible targets", () => {
    renderLinks({
      workItems: [createWorkItem()],
    });

    expect(screen.queryByLabelText("Ticket auswählen")).toBeNull();
  });

  it("hides the add form when the work item is archived", () => {
    renderLinks({
      isArchived: true,
    });

    expect(screen.queryByLabelText("Verknüpfungstyp")).toBeNull();
  });

  it("hides the add form when isAddFormOpen is false", () => {
    renderLinks({ isAddFormOpen: false });

    expect(screen.queryByLabelText("Verknüpfungstyp")).toBeNull();
  });

  it("adds a new link through the add button", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];

    renderLinks({}, (fields) => submitted.push(fields));

    await user.click(screen.getByLabelText("Ticket auswählen"));
    await user.click(
      await screen.findByRole("option", { name: "PAGE-99 Foreign epic" }),
    );

    await user.click(screen.getByRole("button", { name: "Hinzufügen" }));

    expect(submitted.at(-1)).toMatchObject({
      intent: "link-add",
      linkType: WORK_ITEM_LINK_TYPE.RELATES_TO,
      targetKey: "PAGE-99",
      workItemId: "ticket-1",
    });
  });

  it("switches the link type to blocks", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];

    renderLinks({}, (fields) => submitted.push(fields));

    await user.click(screen.getByLabelText("Verknüpfungstyp"));
    await user.click(await screen.findByRole("option", { name: "Blockiert" }));

    await user.click(screen.getByLabelText("Ticket auswählen"));
    await user.click(
      await screen.findByRole("option", { name: "PAGE-99 Foreign epic" }),
    );

    await user.click(screen.getByRole("button", { name: "Hinzufügen" }));

    expect(submitted.at(-1)).toMatchObject({
      linkType: WORK_ITEM_LINK_TYPE.BLOCKS,
    });
  });

  it("does not submit when the target ticket is empty", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];

    renderLinks({}, (fields) => submitted.push(fields));

    await user.click(screen.getByRole("button", { name: "Hinzufügen" }));

    expect(submitted).toHaveLength(0);
  });

  it("disables the add button while submitting", () => {
    renderLinks({ isSubmitting: true });

    expect(screen.getByRole("button", { name: "Hinzufügen" })).toBeDisabled();
  });

  it("disables the add button when no target is selected", () => {
    renderLinks();

    expect(screen.getByRole("button", { name: "Hinzufügen" })).toBeDisabled();
  });

  it("cancels the add form and clears the draft", async () => {
    const user = userEvent.setup();
    const onAddFormOpenChange = vi.fn();

    renderLinks({ onAddFormOpenChange });

    await user.click(screen.getByLabelText("Ticket auswählen"));
    await user.click(
      await screen.findByRole("option", { name: "PAGE-99 Foreign epic" }),
    );

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(onAddFormOpenChange).toHaveBeenCalledWith(false);
  });
});
