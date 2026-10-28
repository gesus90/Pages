// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import DashboardRoute, { loader } from "@/app/routes/dashboard";

import type { DashboardLoaderData } from "@/app/routes/dashboard";

import {
  ACTOR,
  i18n,
  pagesRequest,
  renderRoute,
  routeArguments,
} from "./route-fixture";

// The Frontend setup registers this cleanup; the Node scope repeats it here.
afterEach(cleanup);

const services = vi.hoisted(() => ({
  projectService: { findAll: vi.fn() },
  taskService: {
    countWorkItemsOverview: vi.fn(),
    countWorkItemsByProject: vi.fn(),
    findAll: vi.fn(),
  },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => services,
}));
vi.mock("@/app/components/dashboard/dashboard-header", () => ({
  DashboardHeader: (props: {
    readonly displayName: string;
    readonly hour: number;
  }): React.ReactElement => <p>{`hello ${props.displayName} ${props.hour}`}</p>,
}));
vi.mock("@/app/components/dashboard/dashboard-scroll-area", () => ({
  DashboardScrollArea: (props: {
    readonly children: React.ReactNode;
  }): React.ReactElement => <div>{props.children}</div>,
}));
vi.mock("@/app/components/dashboard/dashboard-kpi-row", () => ({
  DashboardKpiRow: (props: {
    readonly openTickets: number;
    readonly projectCount: number;
  }): React.ReactElement => (
    <p>{`kpi ${props.openTickets} ${props.projectCount}`}</p>
  ),
}));
vi.mock("@/app/components/dashboard/dashboard-panel", () => ({
  DashboardPanel: (props: {
    readonly title: string;
    readonly linkTo: string;
    readonly children: React.ReactNode;
  }): React.ReactElement => (
    <section>
      <h2>{`${props.title} ${props.linkTo}`}</h2>
      {props.children}
    </section>
  ),
}));
vi.mock("@/app/components/dashboard/dashboard-my-tasks", () => ({
  DashboardMyTasks: (props: {
    readonly tasks: readonly unknown[];
  }): React.ReactElement => <p>{`my tasks ${props.tasks.length}`}</p>,
}));
vi.mock("@/app/components/dashboard/dashboard-project-overview", () => ({
  DashboardProjectOverview: (props: {
    readonly projects: readonly unknown[];
  }): React.ReactElement => <p>{`projects ${props.projects.length}`}</p>,
}));
vi.mock("@/app/components/dashboard/dashboard-recently-edited", () => ({
  DashboardRecentlyEdited: (props: {
    readonly items: readonly unknown[];
  }): React.ReactElement => <p>{`recent ${props.items.length}`}</p>,
}));
vi.mock("@/app/components/dashboard/dashboard-upcoming-deadlines", () => ({
  DashboardUpcomingDeadlines: (props: {
    readonly deadlines: readonly unknown[];
  }): React.ReactElement => <p>{`deadlines ${props.deadlines.length}`}</p>,
}));

/**
 * A ticket as the task service lists it.
 *
 * @param id - Ticket identifier.
 * @param dueAt - Due date, if any.
 * @param isDone - Whether the ticket is done.
 */
function ticket(
  id: string,
  dueAt: string | null,
  isDone = false,
): Record<string, unknown> {
  return {
    id,
    dueAt,
    isDone,
    projectName: "Pages",
    title: `Ticket ${id}`,
    updatedAt: "2026-10-27 08:00:00",
  };
}

/**
 * A project as the project service lists it.
 *
 * @param id - Project identifier.
 * @param updatedAt - Last change, which orders the overview.
 * @param options - Progress and creation time.
 */
function project(
  id: string,
  updatedAt: string,
  options: { readonly progress?: number; readonly createdAt?: string } = {},
): Record<string, unknown> {
  return {
    id,
    name: `Project ${id}`,
    updatedAt,
    progress: options.progress ?? 0,
    createdAt: options.createdAt ?? "2026-01-01T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 5, 17, 10, 30, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

it("requires the user of the authentication middleware", async () => {
  await expect(
    loader(routeArguments(pagesRequest("/dashboard"), { user: null })),
  ).rejects.toThrow("Authenticated middleware did not provide a user.");
});

it("aggregates the numbers and sections of the dashboard", async () => {
  services.projectService.findAll.mockResolvedValue([
    project("a", "2026-06-01", {
      progress: 140,
      createdAt: "2026-06-10T00:00:00Z",
    }),
    project("b", "2026-06-05", { progress: -3 }),
    project("c", "2026-06-03", { progress: 42.4 }),
    project("d", "2026-05-01"),
    project("e", "2026-06-04"),
  ]);
  services.taskService.countWorkItemsOverview.mockResolvedValue({
    open: 9,
    openDelta: 2,
    overdue: 1,
    overdueDelta: -1,
    inProgress: 3,
  });
  services.taskService.countWorkItemsByProject.mockResolvedValue(
    new Map([["e", { done: 1, total: 3 }]]),
  );
  services.taskService.findAll
    .mockResolvedValueOnce([
      ticket("today", "2026-06-17T12:00:00"),
      ticket("late", "2026-06-10T12:00:00"),
      ticket("done-late", "2026-06-10T12:00:00", true),
      ticket("none", null),
      ticket("broken", "soon"),
    ])
    .mockResolvedValueOnce([ticket("recent", null)])
    .mockResolvedValueOnce([
      ticket("in-three-days", "2026-06-20T09:00:00"),
      ticket("undated", null),
    ]);

  const loaded = await loader(
    routeArguments(pagesRequest("/dashboard"), { user: ACTOR }),
  );

  expect(loaded).toMatchObject({
    displayName: "Ada Lovelace",
    hour: 10,
    openTickets: 9,
    openDelta: 2,
    overdueTickets: 1,
    overdueDelta: -1,
    inProgressTickets: 3,
    projectCount: 5,
    newProjects: 1,
  });
  expect(
    loaded.myTasks.map((task) => [task.id, task.isDueToday, task.isOverdue]),
  ).toEqual([
    ["today", true, false],
    ["late", false, true],
    ["done-late", false, false],
    ["none", false, false],
    ["broken", false, false],
  ]);
  expect(
    loaded.projectOverview.map((entry) => [entry.id, entry.percentage]),
  ).toEqual([
    ["b", 0],
    ["e", 33],
    ["c", 42],
    ["a", 100],
  ]);
  expect(loaded.recentlyEdited).toEqual([
    {
      id: "recent",
      projectName: "Pages",
      title: "Ticket recent",
      updatedAt: "2026-10-27 08:00:00",
    },
  ]);
  expect(
    loaded.upcomingDeadlines.map((deadline) => [
      deadline.id,
      deadline.daysLeft,
      deadline.dueAt,
    ]),
  ).toEqual([
    ["in-three-days", 3, "2026-06-20T09:00:00"],
    ["undated", 0, ""],
  ]);
  const call: readonly unknown[] =
    services.taskService.countWorkItemsOverview.mock.calls[0] ?? [];
  const [, projectIds, period] = call;
  expect(projectIds).toEqual(["a", "b", "c", "d", "e"]);
  expect(period).toMatchObject({
    userId: "user-1",
    weekAgoStart: "2026-06-10 10:30:00",
  });
});

it("renders the greeting, the numbers and the four panels", () => {
  const loaderData: DashboardLoaderData = {
    displayName: "Ada",
    hour: 9,
    openTickets: 4,
    openDelta: 0,
    overdueTickets: 0,
    overdueDelta: 0,
    inProgressTickets: 1,
    projectCount: 2,
    newProjects: 0,
    myTasks: [],
    projectOverview: [],
    recentlyEdited: [],
    upcomingDeadlines: [],
  };
  vi.useRealTimers();
  renderRoute(DashboardRoute, { loaderData });

  expect(screen.getByText("hello Ada 9")).toBeTruthy();
  expect(screen.getByText("kpi 4 2")).toBeTruthy();
  expect(
    screen.getAllByRole("heading").map((heading) => heading.textContent),
  ).toEqual([
    `${i18n.t("dashboard.myTasks.title")} /aufgaben`,
    `${i18n.t("dashboard.projectOverview.title")} /projekte`,
    `${i18n.t("dashboard.recentlyEdited.title")} /aufgaben`,
    `${i18n.t("dashboard.deadlines.title")} /aufgaben`,
  ]);
  expect(screen.getByText("my tasks 0")).toBeTruthy();
  expect(screen.getByText("deadlines 0")).toBeTruthy();
});
