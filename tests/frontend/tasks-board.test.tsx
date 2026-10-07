// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetcherSubmit: vi.fn(),
  loaderData: vi.fn(),
  submit: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return {
    ...actual,
    useActionData: vi.fn(),
    useFetcher: () => ({
      data: undefined,
      state: "idle",
      submit: mocks.fetcherSubmit,
    }),
    useLoaderData: mocks.loaderData,
    useNavigation: () => ({ formData: undefined, state: "idle" }),
    useSubmit: () => mocks.submit,
  };
});

import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";

import { createI18n } from "@/app/lib/i18n";
import TasksRoute from "@/app/routes/tasks";
import { DEFAULT_BOARD_PREFERENCES } from "@/definition/BoardPreferences";
import { WORK_ITEM_PRIORITY, WORKFLOW_STATUS_KEY } from "@/definition/Task";
import { LANGUAGE } from "@/language/Language";

import { createUser, createWorkItem } from "../helpers/factories";

import type { BoardPreferences } from "@/definition/BoardPreferences";
import type { Label, WorkflowStatus } from "@/definition/Task";

const STATUS_KEYS = [
  ["status-backlog", WORKFLOW_STATUS_KEY.BACKLOG, "Backlog"],
  ["status-todo", WORKFLOW_STATUS_KEY.TODO, "To Do"],
  ["status-in-progress", WORKFLOW_STATUS_KEY.IN_PROGRESS, "In Arbeit"],
  ["status-review", WORKFLOW_STATUS_KEY.REVIEW, "Review"],
  ["status-done", WORKFLOW_STATUS_KEY.DONE, "Done"],
] as const;

const STATUSES: WorkflowStatus[] = STATUS_KEYS.map(
  ([id, key, name], index) => ({
    id,
    isDone: key === WORKFLOW_STATUS_KEY.DONE,
    key,
    name,
    position: index + 1,
    projectId: null,
  }),
);

const BUG: Label = {
  color: "#ef4444",
  createdAt: "",
  id: "label-bug",
  name: "Bug",
  updatedAt: "",
};
const UI: Label = { ...BUG, color: "#3b82f6", id: "label-ui", name: "UI" };

const WORK_ITEMS = [
  createWorkItem({
    departmentId: "department-1",
    id: "item-1",
    key: "PAGE-1",
    priority: WORK_ITEM_PRIORITY.HIGH,
    title: "Alpha Task",
    updatedAt: "2026-01-03",
  }),
  createWorkItem({
    assigneeId: "user-2",
    assigneeName: "Second",
    id: "item-2",
    key: "ASTRO-2",
    priority: WORK_ITEM_PRIORITY.NORMAL,
    projectId: "project-2",
    projectName: "AstroLab",
    statusId: "status-in-progress",
    statusKey: "in_progress",
    title: "Beta Task",
    updatedAt: "2026-01-01",
  }),
  createWorkItem({
    assigneeGroupId: "group-1",
    assigneeGroupName: "Design",
    assigneeId: null,
    assigneeName: null,
    departmentId: "department-2",
    id: "item-3",
    key: "PAGE-3",
    priority: WORK_ITEM_PRIORITY.URGENT,
    title: "Gamma Task",
    updatedAt: "2026-01-02",
  }),
  createWorkItem({
    id: "item-4",
    key: "EPIC-4",
    title: "Delta Epic",
    type: "epic",
  }),
];

function renderBoard(
  options: {
    readonly url?: string;
    readonly board?: Partial<BoardPreferences>;
    readonly canWrite?: boolean;
    readonly labels?: Label[];
    readonly workItems?: typeof WORK_ITEMS;
  } = {},
): void {
  const router = createMemoryRouter([{ element: <TasksRoute />, path: "/" }], {
    initialEntries: [options.url ?? "/"],
  });

  mocks.loaderData.mockReturnValue({
    actor: createUser(),
    archivedFilter: "active",
    assigneeGroups: [{ id: "group-1", memberCount: 2, name: "Design" }],
    assignees: [
      createUser(),
      createUser({ displayName: "Second", id: "user-2" }),
    ],
    board: { ...DEFAULT_BOARD_PREFERENCES, ...options.board },
    departmentChoices: {
      available: [
        { id: "department-1", name: "Entwicklung" },
        { id: "department-2", name: "Support" },
      ],
    },
    githubStates: [],
    labels: options.labels ?? [BUG, UI],
    labelsByWorkItem: {
      "item-1": [BUG],
      "item-3": [BUG, UI],
    },
    memberGroupIds: ["group-1"],
    milestones: [],
    permissions: { canDelete: false, canWrite: options.canWrite ?? true },
    projects: [
      { id: "project-1", name: "Pages" },
      { id: "project-2", name: "AstroLab" },
    ],
    selectedHistory: [],
    selectedItem: null,
    selectedPullRequests: [],
    selectedSubtasks: [],
    statuses: STATUSES,
    templates: [],
    workItems: options.workItems ?? WORK_ITEMS,
  });

  render(
    <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

async function choose(
  user: ReturnType<typeof userEvent.setup>,
  select: string,
  option: string,
): Promise<void> {
  await user.click(screen.getByRole("combobox", { name: select }));
  await user.click(await screen.findByRole("option", { name: option }));
}

function visibleKeys(): string[] {
  return ["PAGE-1", "ASTRO-2", "PAGE-3", "EPIC-4"].filter(
    (key) => screen.queryByText(key) !== null,
  );
}

describe("tasks board", () => {
  beforeEach(() => {
    mocks.fetcherSubmit.mockReset();
    mocks.submit.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the tasks and subtasks of every project by default", () => {
    renderBoard();

    expect(visibleKeys()).toEqual(["PAGE-1", "ASTRO-2", "PAGE-3"]);
  });

  it("makes initiatives and epics reachable through the type filter", async () => {
    const user = userEvent.setup();

    renderBoard();
    await choose(user, "Typ", "Alle Typen");

    expect(visibleKeys()).toContain("EPIC-4");

    await choose(user, "Typ", "Epic");

    expect(visibleKeys()).toEqual(["EPIC-4"]);
  });

  it("shows every type in the hierarchy view without a type filter", async () => {
    const user = userEvent.setup();

    renderBoard({ board: { view: "hierarchy" } });

    expect(screen.getByText("EPIC-4")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Kanban" }));
    expect(screen.queryByText("EPIC-4")).not.toBeInTheDocument();
  });

  it("filters by a person, a group and the unassigned", async () => {
    const user = userEvent.setup();

    renderBoard();
    await choose(user, "Person", "Second");
    expect(visibleKeys()).toEqual(["ASTRO-2"]);

    await choose(user, "Person", "Gruppe: Design");
    expect(visibleKeys()).toEqual(["PAGE-3"]);

    await choose(user, "Person", "Nicht zugewiesen");
    expect(visibleKeys()).toEqual([]);
  });

  it("filters by department including tickets without one", async () => {
    const user = userEvent.setup();

    renderBoard();
    await choose(user, "Abteilung", "Support");
    expect(visibleKeys()).toEqual(["PAGE-3"]);

    await choose(user, "Abteilung", "Ohne Abteilung");
    expect(visibleKeys()).toEqual(["ASTRO-2"]);
  });

  it("filters by several labels and clears the filter again", async () => {
    const user = userEvent.setup();

    renderBoard();

    const trigger = screen.getByRole("button", { name: "Labels" });

    expect(trigger).toHaveTextContent("Alle Labels");
    await user.click(trigger);
    await user.click(
      await screen.findByRole("menuitemcheckbox", { name: "UI" }),
    );
    expect(visibleKeys()).toEqual(["PAGE-3"]);
    expect(trigger).toHaveTextContent("1 Labels");

    await user.click(screen.getByRole("menuitemcheckbox", { name: "Bug" }));
    expect(visibleKeys()).toEqual(["PAGE-1", "PAGE-3"]);

    await user.click(screen.getByRole("menuitemcheckbox", { name: "UI" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Bug" }));
    expect(visibleKeys()).toEqual(["PAGE-1", "ASTRO-2", "PAGE-3"]);
  });

  it("explains an empty label catalog", async () => {
    const user = userEvent.setup();

    renderBoard({ labels: [] });
    await user.click(screen.getByRole("button", { name: "Labels" }));

    expect(await screen.findByText("Noch keine Labels.")).toBeInTheDocument();
  });

  it("restricts the board to the own tickets", async () => {
    const user = userEvent.setup();

    renderBoard();
    await user.click(screen.getByRole("button", { name: "Meine Aufgaben" }));

    expect(visibleKeys()).toEqual(["PAGE-1", "PAGE-3"]);
  });

  it("starts from the view in the address", () => {
    renderBoard({ url: "/?view=list&sort=title&dir=desc" });

    expect(
      screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent?.match(/(PAGE|ASTRO)-\d/)?.[0]),
    ).toEqual(["PAGE-3", "ASTRO-2", "PAGE-1"]);
  });

  it("names the group or nobody for tickets without a person in the list", () => {
    renderBoard({
      board: { view: "list" },
      workItems: [
        WORK_ITEMS[2] as (typeof WORK_ITEMS)[number],
        createWorkItem({
          assigneeId: null,
          assigneeName: null,
          id: "item-9",
          key: "PAGE-9",
        }),
      ],
    });

    expect(screen.getByText("Design")).toBeInTheDocument();
    expect(screen.getByText("Nicht zugewiesen")).toBeInTheDocument();
  });

  it("sorts the list by the chosen field and reverses the direction", async () => {
    const user = userEvent.setup();
    const keys = (): (string | undefined)[] =>
      screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent?.match(/(PAGE|ASTRO)-\d/)?.[0]);

    renderBoard({ board: { view: "list" } });
    await choose(user, "Sortierung", "Priorität");
    expect(keys()).toEqual(["ASTRO-2", "PAGE-1", "PAGE-3"]);

    await user.click(
      screen.getByRole("button", {
        name: "Aufsteigend sortiert, zum Umkehren klicken",
      }),
    );
    expect(keys()).toEqual(["PAGE-3", "PAGE-1", "ASTRO-2"]);
    expect(
      screen.getByRole("button", {
        name: "Absteigend sortiert, zum Umkehren klicken",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByText("Titel"));
    expect(keys()).toEqual(["PAGE-1", "ASTRO-2", "PAGE-3"]);

    await user.click(
      screen.getByRole("button", {
        name: "Aufsteigend sortiert, zum Umkehren klicken",
      }),
    );
    expect(keys()).toEqual(["PAGE-3", "ASTRO-2", "PAGE-1"]);
    await user.click(
      screen.getByRole("button", {
        name: "Absteigend sortiert, zum Umkehren klicken",
      }),
    );
    expect(keys()).toEqual(["PAGE-1", "ASTRO-2", "PAGE-3"]);
  });

  it("sorts the cards of a kanban column", async () => {
    const user = userEvent.setup();

    renderBoard({
      board: { sort: "title" },
    });

    const todoColumn = screen
      .getByRole("heading", { name: "To Do" })
      .closest("section") as HTMLElement;

    expect(
      within(todoColumn)
        .getAllByRole("heading", { level: 4 })
        .map((heading) => heading.textContent),
    ).toEqual(["Alpha Task", "Gamma Task"]);

    await user.click(
      screen.getByRole("button", {
        name: "Aufsteigend sortiert, zum Umkehren klicken",
      }),
    );

    expect(
      within(todoColumn)
        .getAllByRole("heading", { level: 4 })
        .map((heading) => heading.textContent),
    ).toEqual(["Gamma Task", "Alpha Task"]);
  });

  it("groups the kanban board into sections above the status columns", async () => {
    const user = userEvent.setup();

    renderBoard();
    await choose(user, "Gruppierung", "Nach Projekt");

    const headings = screen.getAllByRole("heading", { level: 2 });

    expect(headings.map((heading) => heading.textContent)).toEqual([
      "AstroLab1",
      "Pages2",
    ]);

    const pages = screen.getByRole("region", { name: /^Pages/ });

    expect(
      within(pages).getAllByRole("heading", { name: "To Do" }),
    ).toHaveLength(1);
    expect(within(pages).getByText("PAGE-1")).toBeInTheDocument();
    expect(within(pages).queryByText("ASTRO-2")).not.toBeInTheDocument();
  });

  it.each([
    ["Nach Priorität", ["Dringend", "Hoch", "Mittel"]],
    ["Nach Bearbeiter", ["Admin User", "Design", "Second"]],
    ["Nach Abteilung", ["Entwicklung", "Support", "Ohne Abteilung"]],
    ["Nach Label", ["Bug", "UI", "Ohne Label"]],
  ])("names the sections of the grouping %s", async (option, titles) => {
    const user = userEvent.setup();

    renderBoard();
    await choose(user, "Gruppierung", option);

    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent?.replace(/\d+$/, "")),
    ).toEqual(titles);
  });

  it("names the section of unassigned tickets", () => {
    renderBoard({
      board: { group: "assignee" },
      workItems: [
        createWorkItem({
          assigneeId: null,
          assigneeName: null,
          id: "item-9",
          key: "PAGE-9",
        }),
      ],
    });

    expect(
      screen.getByRole("heading", { level: 2, name: /^Nicht zugewiesen/ }),
    ).toBeInTheDocument();
  });

  it("shows the ungrouped board again", async () => {
    const user = userEvent.setup();

    renderBoard({ board: { group: "project" } });
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(2);

    await choose(user, "Gruppierung", "Keine Gruppierung");
    expect(screen.queryAllByRole("heading", { level: 2 })).toHaveLength(0);
  });

  it("moves a ticket from a grouped section by drag and drop", () => {
    renderBoard({ board: { group: "project" } });

    const pages = screen.getByRole("region", { name: /^Pages/ });
    const dataTransfer = {
      getData: vi.fn().mockReturnValue("item-1"),
      setData: vi.fn(),
    };

    act(() => {
      screen.getByText("Alpha Task").dispatchEvent(
        Object.assign(new Event("dragstart", { bubbles: true }), {
          dataTransfer,
        }),
      );
    });
    act(() => {
      within(pages)
        .getByRole("heading", { name: "Review" })
        .dispatchEvent(
          Object.assign(new Event("drop", { bubbles: true }), { dataTransfer }),
        );
    });

    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "item-1", statusId: "status-review" }),
      { method: "post" },
    );
  });

  it("changes the status of a card with a select instead of dragging", async () => {
    const user = userEvent.setup();

    renderBoard();
    await choose(user, "Status von PAGE-1 ändern", "Review");

    expect(mocks.submit).toHaveBeenCalledWith(
      {
        id: "item-1",
        intent: "move-task",
        sortOrder: "1",
        statusId: "status-review",
      },
      { method: "post" },
    );
  });

  it("appends a card moved by select behind the tickets of the target column", async () => {
    const user = userEvent.setup();

    renderBoard();
    await choose(user, "Status von PAGE-1 ändern", "In Arbeit");

    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        sortOrder: "2",
        statusId: "status-in-progress",
      }),
      { method: "post" },
    );
  });

  it("offers no status select without write permission", () => {
    renderBoard({ canWrite: false });

    expect(
      screen.queryByRole("combobox", { name: /Status von PAGE-1/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps the search text while typing and filters by it", async () => {
    const user = userEvent.setup();

    renderBoard();
    await user.type(screen.getByPlaceholderText("Aufgaben suchen …"), "gamma");

    expect(screen.getByPlaceholderText("Aufgaben suchen …")).toHaveValue(
      "gamma",
    );
    expect(visibleKeys()).toEqual(["PAGE-3"]);
  });

  it("saves the changed view after a pause, only once", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderBoard();
    expect(mocks.fetcherSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Liste" }));
    await user.click(screen.getByRole("button", { name: "Meine Aufgaben" }));
    expect(mocks.fetcherSubmit).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(mocks.fetcherSubmit).toHaveBeenCalledTimes(1);

    const [fields, options] = mocks.fetcherSubmit.mock.calls[0] as [
      Record<string, string>,
      unknown,
    ];

    expect(fields.intent).toBe("save-board-preferences");
    expect(JSON.parse(fields.preferences)).toMatchObject({
      scope: "mine",
      view: "list",
    });
    expect(options).toEqual({ method: "post" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(mocks.fetcherSubmit).toHaveBeenCalledTimes(1);
  });
});
