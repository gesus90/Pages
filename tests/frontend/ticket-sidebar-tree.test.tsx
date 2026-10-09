// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TicketSidebarSection } from "@/app/components/tasks/tree/ticket-sidebar-section";
import { createI18n } from "@/app/lib/i18n";
import { TICKET_LAYOUT_ROUTE_ID } from "@/app/lib/ticket-tree";
import { DEFAULT_BOARD_PREFERENCES } from "@/definition/BoardPreferences";
import { WORK_ITEM_TYPE } from "@/definition/Task";
import { LANGUAGE } from "@/language/Language";

import type { TicketLayoutData } from "@/app/routes/tasks-layout";
import type { TicketTreeEntry, WorkItemType } from "@/definition/Task";

function entry(
  key: string,
  type: WorkItemType,
  parentKey: string | null = null,
  overrides: Partial<TicketTreeEntry> = {},
): TicketTreeEntry {
  return {
    id: key,
    isDone: false,
    key,
    parentId: parentKey,
    projectId: "p1",
    projectName: "Pages",
    statusKey: "todo",
    statusName: "To Do",
    title: `Titel ${key}`,
    type,
    ...overrides,
  };
}

const LEVELS: TicketTreeEntry[] = [
  entry("PAGE-1", WORK_ITEM_TYPE.INITIATIVE),
  entry("PAGE-2", WORK_ITEM_TYPE.EPIC, "PAGE-1"),
  entry("PAGE-3", WORK_ITEM_TYPE.TASK, "PAGE-2", { statusKey: "done" }),
  entry("PAGE-4", WORK_ITEM_TYPE.SUBTASK, "PAGE-3"),
  entry("PAGE-5", WORK_ITEM_TYPE.TASK),
];

let submissions: Record<string, FormDataEntryValue>[] = [];

interface RenderOptions {
  readonly entries?: readonly TicketTreeEntry[];
  readonly expandedKeys?: readonly string[];
  readonly path?: string;
  readonly boardView?: string;
  readonly onNavigate?: () => void;
}

function renderTree({
  entries = LEVELS,
  expandedKeys = [],
  path = "/aufgaben",
  boardView = "kanban",
  onNavigate,
}: RenderOptions = {}): void {
  const layout: TicketLayoutData = { entries, expandedKeys };
  const sidebar = (
    <>
      <TicketSidebarSection onNavigate={onNavigate} />
      <Outlet />
    </>
  );
  const router = createMemoryRouter(
    [
      { element: <TicketSidebarSection />, path: "/wiki" },
      {
        children: [
          {
            action: async ({ request }) => {
              submissions.push(Object.fromEntries(await request.formData()));

              return { ok: true };
            },
            element: <p>Board</p>,
            id: "aufgaben",
            loader: () => ({
              board: { ...DEFAULT_BOARD_PREFERENCES, view: boardView },
            }),
            path: "/aufgaben",
          },
          { element: <p>Ticket</p>, path: "/aufgaben/:ticketKey" },
        ],
        element: sidebar,
        id: TICKET_LAYOUT_ROUTE_ID,
        loader: () => layout,
      },
    ],
    { initialEntries: [path] },
  );

  render(
    <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  submissions = [];
});

describe("TicketSidebarSection", () => {
  it("shows nothing outside the ticket pages", async () => {
    renderTree({ path: "/wiki" });

    await waitFor(() =>
      expect(screen.queryByRole("navigation")).not.toBeInTheDocument(),
    );
  });

  it("offers the board, the hierarchy and the first level of the tree", async () => {
    const onNavigate = vi.fn();

    renderTree({ onNavigate });

    const nav = await screen.findByRole("navigation", {
      name: "Aufgaben-Navigation",
    });

    expect(
      within(nav).getByRole("link", { name: "Kanban-Board" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(nav).getByRole("link", { name: "Hierarchie" }),
    ).toHaveAttribute("href", "/aufgaben?view=hierarchy");
    expect(within(nav).getByRole("link", { name: /PAGE-1/ })).toHaveAttribute(
      "href",
      "/aufgaben/PAGE-1?from=hierarchy",
    );
    expect(within(nav).getByText("Ohne Epic")).toBeVisible();
    expect(within(nav).queryByText("Titel PAGE-2")).not.toBeInTheDocument();

    await userEvent.click(
      within(nav).getByRole("link", { name: "Hierarchie" }),
    );
    expect(onNavigate).toHaveBeenCalled();
  });

  it("marks the hierarchy view and opens every level, also tasks to their subtasks", async () => {
    renderTree({ boardView: "hierarchy" });

    const nav = await screen.findByRole("navigation");

    expect(
      within(nav).getByRole("link", { name: "Hierarchie" }),
    ).toHaveAttribute("aria-current", "page");

    for (const title of [
      "PAGE-1 Titel PAGE-1",
      "PAGE-2 Titel PAGE-2",
      "PAGE-3 Titel PAGE-3",
    ]) {
      await userEvent.click(
        within(nav).getByRole("button", { name: `${title} aufklappen` }),
      );
    }

    expect(within(nav).getByRole("link", { name: /PAGE-4/ })).toBeVisible();
    expect(within(nav).getByText("Subtask PAGE-4")).toHaveClass("sr-only");
    expect(within(nav).getByRole("link", { name: /PAGE-4/ })).toHaveAttribute(
      "title",
      "PAGE-4 Titel PAGE-4",
    );
    expect(
      within(nav).getAllByRole("img", { name: "Status: To Do" }).length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(submissions).toHaveLength(3));
    expect(submissions[0]).toEqual({
      expanded: "1",
      intent: "set-tree-expanded",
      nodeKey: "PAGE-1",
    });

    await userEvent.click(
      within(nav).getByRole("button", {
        name: "PAGE-1 Titel PAGE-1 zuklappen",
      }),
    );
    expect(within(nav).queryByText("Titel PAGE-2")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(submissions.at(-1)).toMatchObject({
        expanded: "0",
        nodeKey: "PAGE-1",
      }),
    );

    await userEvent.click(
      within(nav).getByRole("button", { name: "Ohne Epic aufklappen" }),
    );
    expect(within(nav).getByRole("link", { name: /PAGE-5/ })).toBeVisible();
  });

  it("opens the path of the ticket on its page and marks it", async () => {
    renderTree({ path: "/aufgaben/PAGE-4" });

    const current = await screen.findByRole("link", { name: /PAGE-4/ });

    expect(current).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("link", { name: "Kanban-Board" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("opens the path of another ticket when the person moves there", async () => {
    renderTree({ path: "/aufgaben/PAGE-3", expandedKeys: ["no-epic:p1"] });

    await userEvent.click(await screen.findByRole("link", { name: /PAGE-5/ }));
    await userEvent.click(
      screen.getByRole("button", { name: "PAGE-3 Titel PAGE-3 aufklappen" }),
    );

    expect(screen.getByRole("link", { name: /PAGE-5/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /PAGE-4/ })).toBeVisible();
  });

  it("restores stored branches and groups several projects", async () => {
    renderTree({
      entries: [
        ...LEVELS,
        entry("TOOL-1", WORK_ITEM_TYPE.EPIC, null, {
          projectId: "p2",
          projectName: "Tools",
        }),
      ],
      expandedKeys: ["project:p2", "no-initiative:p2"],
    });

    const nav = await screen.findByRole("navigation");

    expect(within(nav).getByText("Pages")).toBeVisible();
    expect(within(nav).getByRole("link", { name: /TOOL-1/ })).toBeVisible();
    expect(
      within(nav).queryByRole("link", { name: /PAGE-1/ }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      within(nav).getByRole("button", { name: "Pages aufklappen" }),
    );
    expect(within(nav).getByRole("link", { name: /PAGE-1/ })).toBeVisible();
  });

  it("shows long groups in steps and says when there is nothing", async () => {
    renderTree({
      entries: Array.from({ length: 60 }, (_, index) =>
        entry(`PAGE-${index + 10}`, WORK_ITEM_TYPE.TASK),
      ),
      expandedKeys: ["no-epic:p1"],
    });

    const nav = await screen.findByRole("navigation");

    expect(
      within(nav).getAllByRole("link", { name: /PAGE-\d+ Titel/ }),
    ).toHaveLength(50);
    await userEvent.click(
      within(nav).getByRole("button", { name: "10 weitere anzeigen" }),
    );
    expect(
      within(nav).getAllByRole("link", { name: /PAGE-\d+ Titel/ }),
    ).toHaveLength(60);
  });

  it.each(["PAGE-69", "PAGE-70"])(
    "shows the active ticket %s beyond the first 50 entries and its path",
    async (ticketKey) => {
      renderTree({
        entries: [
          ...Array.from({ length: 60 }, (_, index) =>
            entry(`PAGE-${index + 10}`, WORK_ITEM_TYPE.TASK),
          ),
          entry("PAGE-70", WORK_ITEM_TYPE.SUBTASK, "PAGE-69"),
        ],
        path: `/aufgaben/${ticketKey}`,
      });

      expect(
        await screen.findByRole("link", { name: new RegExp(ticketKey) }),
      ).toHaveAttribute("aria-current", "page");
    },
  );

  it("says when there are no tickets", async () => {
    renderTree({ entries: [] });

    expect(await screen.findByText("Noch keine Einträge.")).toBeVisible();
  });
});
