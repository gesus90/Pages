// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WikiActionDialog } from "@/app/components/wiki/wiki-action-dialog";
import { WikiAnchorsDialog } from "@/app/components/wiki/wiki-anchors-dialog";
import { WikiConflictDialog } from "@/app/components/wiki/wiki-conflict-dialog";
import { WikiHistoryDialog } from "@/app/components/wiki/wiki-history-dialog";
import { WikiNewPageButton } from "@/app/components/wiki/wiki-new-page-dialog";
import {
  WikiCurrentUntilDialog,
  WikiDeleteDialog,
  WikiDuplicateDialog,
  WikiOwnerDialog,
} from "@/app/components/wiki/wiki-page-dialogs";
import { WikiPrivatePlaceholderView } from "@/app/components/wiki/wiki-private-placeholder";

import { renderInWiki } from "../helpers/wiki-render";

import type { WikiAnchorChoices, WikiPage } from "@/definition/Wiki";

const PAGE: WikiPage = {
  anchors: [],
  breadcrumb: [],
  content: "text",
  createdAt: "2026-01-01 10:00:00",
  currentUntil: "2026-12-31",
  icon: null,
  id: "p1",
  isTemplate: false,
  ownerId: "o1",
  ownerName: "Olga",
  parentId: null,
  projectId: null,
  projectName: null,
  revision: 1,
  scope: "instance",
  title: "Guide",
  updatedAt: "2026-01-02 10:00:00",
  updatedByName: "Olga",
};

describe("WikiNewPageButton", () => {
  const projects = [{ id: "p1", name: "Project One" }];
  const templates = [{ icon: null, id: "t1", title: "My template" }];

  it("creates a blank page in the general area", async () => {
    const { layoutSubmissions } = renderInWiki(
      <WikiNewPageButton
        label="New page"
        projects={projects}
        templates={templates}
      />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "New page" }),
    );
    await userEvent.type(screen.getByLabelText("Title"), "First");
    await userEvent.click(screen.getByRole("button", { name: "Create page" }));

    await waitFor(() => expect(layoutSubmissions).toHaveLength(1));
    expect(layoutSubmissions[0]).toMatchObject({
      content: "",
      intent: "create-page",
      parentId: "",
      projectId: "",
      scope: "instance",
      templateId: "",
      title: "First",
    });
  });

  it("creates in a project from a built-in template", async () => {
    const { layoutSubmissions } = renderInWiki(
      <WikiNewPageButton
        label="New page"
        projects={projects}
        templates={templates}
      />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "New page" }),
    );
    await userEvent.type(screen.getByLabelText("Title"), "Decision");
    await userEvent.click(screen.getByRole("combobox", { name: "Area" }));
    await userEvent.click(
      await screen.findByRole("option", { name: "Project One" }),
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Template" }));
    await userEvent.click(
      await screen.findByRole("option", { name: "Decision" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Create page" }));

    await waitFor(() => expect(layoutSubmissions).toHaveLength(1));
    expect(layoutSubmissions[0]).toMatchObject({
      projectId: "p1",
      scope: "project",
    });
    expect(String(layoutSubmissions[0]?.content)).toContain("## Context");
  });

  it("copies a template page and creates below a parent without an area", async () => {
    const { layoutSubmissions } = renderInWiki(
      <WikiNewPageButton
        label="New subpage"
        parentId="parent-1"
        projects={projects}
        templates={templates}
        variant="outline"
      />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "New subpage" }),
    );

    expect(screen.queryByRole("combobox", { name: "Area" })).toBeNull();

    await userEvent.type(screen.getByLabelText("Title"), "Sub");
    await userEvent.click(screen.getByRole("combobox", { name: "Template" }));
    await userEvent.click(
      await screen.findByRole("option", { name: "My template" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Create page" }));

    await waitFor(() => expect(layoutSubmissions).toHaveLength(1));
    expect(layoutSubmissions[0]).toMatchObject({
      parentId: "parent-1",
      templateId: "t1",
    });
  });

  it("shows the reason when creating fails", async () => {
    renderInWiki(
      <WikiNewPageButton label="New page" projects={projects} templates={[]} />,
      {
        layoutAnswers: { "create-page": { error: "titleTooLong", ok: false } },
      },
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "New page" }),
    );
    await userEvent.type(screen.getByLabelText("Title"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Create page" }));

    expect(
      await screen.findByText("The title must not exceed 200 characters."),
    ).toBeVisible();
  });
});

describe("WikiActionDialog", () => {
  it("sends its fields and closes on success", async () => {
    const onClose = vi.fn();
    const { layoutSubmissions } = renderInWiki(
      <WikiActionDialog
        action="/wiki"
        description="Sure?"
        fields={{ intent: "delete-page", pageId: "p1" }}
        isDestructive
        submitLabel="Do it"
        title="Title"
        onClose={onClose}
      >
        <input name="extra" type="hidden" value="1" />
      </WikiActionDialog>,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Do it" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(layoutSubmissions[0]).toEqual({
      extra: "1",
      intent: "delete-page",
      pageId: "p1",
    });
  });

  it("shows an error and cancels", async () => {
    const onClose = vi.fn();

    renderInWiki(
      <WikiActionDialog
        action="/wiki"
        description="Sure?"
        fields={{ intent: "x" }}
        submitLabel="Do it"
        title="Title"
        onClose={onClose}
      />,
      { layoutAnswers: { x: { error: "forbidden", ok: false } } },
    );

    await userEvent.click(await screen.findByRole("button", { name: "Do it" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You lack the permission for this.",
    );
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
  });
});

describe("page dialogs", () => {
  it("confirms the deletion of a page", async () => {
    const { layoutSubmissions } = renderInWiki(
      <WikiDeleteDialog page={PAGE} onClose={vi.fn()} />,
    );

    expect(await screen.findByText("Delete “Guide”?")).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Move to trash" }),
    );

    await waitFor(() =>
      expect(layoutSubmissions[0]).toMatchObject({
        intent: "delete-page",
        pageId: "p1",
      }),
    );
  });

  it("duplicates with the subpages on request", async () => {
    const { layoutSubmissions } = renderInWiki(
      <WikiDuplicateDialog page={PAGE} onClose={vi.fn()} />,
    );

    expect(await screen.findByLabelText("Title")).toHaveValue("Copy of Guide");
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Copy subpages too" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Duplicate" }));

    await waitFor(() =>
      expect(layoutSubmissions[0]).toMatchObject({
        intent: "duplicate-page",
        template: "0",
        title: "Copy of Guide",
        withChildren: "1",
      }),
    );
  });

  it("saves a copy as a template without offering subpages", async () => {
    const { layoutSubmissions } = renderInWiki(
      <WikiDuplicateDialog asTemplate page={PAGE} onClose={vi.fn()} />,
    );

    await screen.findByRole("dialog", { name: "Save as template" });

    expect(screen.queryByRole("checkbox")).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "Save template" }),
    );

    await waitFor(() =>
      expect(layoutSubmissions[0]).toMatchObject({
        template: "1",
        withChildren: "0",
      }),
    );
  });

  it("sets the review date on the page", async () => {
    const { pageSubmissions } = renderInWiki(
      <WikiCurrentUntilDialog page={PAGE} onClose={vi.fn()} />,
      { path: "/wiki/p1" },
    );

    const date = await screen.findByLabelText("Date (empty = no expiry)");

    expect(date).toHaveValue("2026-12-31");
    await userEvent.clear(date);
    await userEvent.type(date, "2027-01-15");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(pageSubmissions[0]).toEqual({
        currentUntil: "2027-01-15",
        intent: "set-current-until",
      }),
    );
  });

  it("starts the review date empty for a page without one", async () => {
    renderInWiki(
      <WikiCurrentUntilDialog
        page={{ ...PAGE, currentUntil: null }}
        onClose={vi.fn()}
      />,
      { path: "/wiki/p1" },
    );

    expect(
      await screen.findByLabelText("Date (empty = no expiry)"),
    ).toHaveValue("");
  });

  it("hands the page over to another owner", async () => {
    const { pageSubmissions } = renderInWiki(
      <WikiOwnerDialog
        owners={[
          { displayName: "Olga", id: "o1" },
          { displayName: "Max", id: "o2" },
        ]}
        page={PAGE}
        onClose={vi.fn()}
      />,
      { path: "/wiki/p1" },
    );

    await userEvent.click(
      await screen.findByRole("combobox", { name: "New owner" }),
    );
    await userEvent.click(await screen.findByRole("option", { name: "Max" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(pageSubmissions[0]).toEqual({
        intent: "set-owner",
        ownerId: "o2",
      }),
    );
  });
});

describe("WikiAnchorsDialog", () => {
  const choices: WikiAnchorChoices = {
    departments: [{ id: "d1", name: "Sales" }],
    epics: [{ id: "e1", key: "PAGE-1", title: "Launch" }],
    milestones: [{ id: "m1", name: "Beta", projectName: "Pages" }],
    selected: [{ kind: "department", targetId: "d1" }],
  };

  it("lists the targets, preselects the current ones and sends the choice", async () => {
    const { pageSubmissions } = renderInWiki(
      <WikiAnchorsDialog choices={choices} page={PAGE} onClose={vi.fn()} />,
      { path: "/wiki/p1" },
    );

    expect(
      await screen.findByRole("checkbox", { name: "Sales" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Pages / Beta" }),
    ).not.toBeChecked();
    await userEvent.click(
      screen.getByRole("checkbox", { name: "PAGE-1 – Launch" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(pageSubmissions[0]).toEqual({
        anchor: ["department:d1", "epic:e1"],
        intent: "set-anchors",
      }),
    );
  });

  it("warns about targets that are gone and skips empty groups", async () => {
    renderInWiki(
      <WikiAnchorsDialog
        choices={{ departments: [], epics: [], milestones: [], selected: [] }}
        page={{
          ...PAGE,
          anchors: [{ kind: "epic", label: null, targetId: "gone" }],
        }}
        onClose={vi.fn()}
      />,
      { path: "/wiki/p1" },
    );

    expect(
      await screen.findByText(/1 link\(s\) point to deleted targets/),
    ).toBeVisible();
    expect(screen.queryByText("Departments")).toBeNull();
  });
});

describe("WikiHistoryDialog", () => {
  const versions = [
    {
      authorName: "Olga",
      createdAt: "2026-01-02 10:00:00",
      id: "v2",
      revision: 2,
      updatedAt: "2026-01-02 10:05:00",
    },
    {
      authorName: "Max",
      createdAt: "2026-01-01 10:00:00",
      id: "v1",
      revision: 1,
      updatedAt: "2026-01-01 10:00:00",
    },
  ];

  it("previews a version and restores it", async () => {
    const onClose = vi.fn();
    const { pageSubmissions } = renderInWiki(
      <WikiHistoryDialog
        canRestore
        page={PAGE}
        versions={versions}
        onClose={onClose}
      />,
      {
        pageAnswers: {
          "get-version": {
            ok: true,
            version: { content: "# Old text", id: "v1" },
          },
        },
        path: "/wiki/p1",
      },
    );

    const rows = await screen.findAllByRole("listitem");

    expect(
      within(rows[0] as HTMLElement).getByText(/Olga · 2026-01-02/),
    ).toBeVisible();

    await userEvent.click(
      within(rows[1] as HTMLElement).getByRole("button", { name: "Preview" }),
    );

    const preview = await screen.findByLabelText("Preview of the version");

    expect(
      within(preview).getByRole("heading", { name: "Old text" }),
    ).toBeVisible();

    await userEvent.click(
      within(rows[1] as HTMLElement).getByRole("button", { name: "Restore" }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(pageSubmissions.map((entry) => entry.intent)).toEqual([
      "get-version",
      "restore-version",
    ]);
  });

  it("hides restoring without the right to edit and shows a failure", async () => {
    renderInWiki(
      <WikiHistoryDialog
        canRestore={false}
        page={PAGE}
        versions={versions}
        onClose={vi.fn()}
      />,
      { path: "/wiki/p1" },
    );

    await screen.findAllByRole("listitem");

    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });

  it("shows why restoring failed and closes with the button", async () => {
    const onClose = vi.fn();

    renderInWiki(
      <WikiHistoryDialog
        canRestore
        page={PAGE}
        versions={versions}
        onClose={onClose}
      />,
      {
        pageAnswers: {
          "restore-version": { error: "versionMissing", ok: false },
        },
        path: "/wiki/p1",
      },
    );

    await userEvent.click(
      (
        await screen.findAllByRole("button", { name: "Restore" })
      )[0] as HTMLElement,
    );

    expect(
      await screen.findByText("This version does not exist."),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalled();
  });
});

describe("WikiConflictDialog", () => {
  it("offers the three ways out and compares the texts", async () => {
    const onKeepMine = vi.fn();
    const onTakeTheirs = vi.fn();

    renderInWiki(
      <WikiConflictDialog
        mine={"same\nmine"}
        theirs={"same\ntheirs"}
        onKeepMine={onKeepMine}
        onTakeTheirs={onTakeTheirs}
      />,
    );

    await screen.findByRole("dialog", {
      name: "The page was changed in the meantime",
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Show differences" }),
    );

    const differences = screen.getByLabelText("Differences");

    expect(differences).toHaveTextContent("- theirs");
    expect(differences).toHaveTextContent("+ mine");
    expect(differences).toHaveTextContent("same");
    await userEvent.click(
      screen.getByRole("button", { name: "Show differences" }),
    );

    expect(screen.queryByLabelText("Differences")).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "Take their version" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Keep my version" }),
    );
    await userEvent.keyboard("{Escape}");

    expect(onTakeTheirs).toHaveBeenCalled();
    expect(onKeepMine).toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeVisible();
  });
});

describe("WikiPrivatePlaceholderView", () => {
  it("shows owner and address, never a title, and deletes after confirmation", async () => {
    const { layoutSubmissions } = renderInWiki(
      <WikiPrivatePlaceholderView
        placeholder={{ id: "p1", ownerId: "o1", ownerName: "Olga" }}
      />,
    );

    expect(await screen.findByText("Olga")).toBeVisible();
    expect(screen.getByText("/wiki/p1")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Delete page" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Delete private page?",
    });

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete page" }),
    );
    await waitFor(() =>
      expect(layoutSubmissions[0]).toEqual({
        intent: "delete-private-page",
        pageId: "p1",
      }),
    );
  });

  it("closes the confirmation without deleting", async () => {
    renderInWiki(
      <WikiPrivatePlaceholderView
        placeholder={{ id: "p1", ownerId: "o1", ownerName: "Olga" }}
      />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Delete page" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Cancel" }),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
