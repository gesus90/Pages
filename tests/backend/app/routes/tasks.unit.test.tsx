// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { handleTaskAction } from "@/app/lib/task-actions/task-actions.server";
import TasksRoute, {
  action,
  loader,
  parseArchivedFilter,
  shouldRevalidate,
} from "@/app/routes/tasks";
import { DEFAULT_BOARD_PREFERENCES } from "@/definition/BoardPreferences";
import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import { WorkItemNotFoundError } from "@/backend/error/WorkItemErrors";

import {
  ACTOR,
  formPost,
  pagesRequest,
  renderRoute,
  responseOf,
  routeArguments,
} from "./route-fixture";

import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { BoardPreferences } from "@/definition/BoardPreferences";

// The Frontend setup registers this cleanup; the Node scope repeats it here.
afterEach(cleanup);

const services = vi.hoisted(() => ({
  projectService: { findAll: vi.fn(), findIntegrationsByProjects: vi.fn() },
  taskService: {
    canArchiveAny: vi.fn(),
    findAll: vi.fn(),
    findLabelsForWorkItems: vi.fn(),
    findAssigneesByProjects: vi.fn(),
    countLabelUsage: vi.fn(),
    findLabels: vi.fn(),
    findAssigneeGroupIdsByProject: vi.fn(),
    findAssigneeGroups: vi.fn(),
    departmentChoices: vi.fn(),
    findMilestones: vi.fn(),
    findAllStatuses: vi.fn(),
    findMemberGroupIds: vi.fn(),
    actionPermissions: vi.fn(),
    getByKey: vi.fn(),
    findChecklistItems: vi.fn(),
    describeDescendants: vi.fn(),
    getHistory: vi.fn(),
    findLinks: vi.fn(),
    findSubtasks: vi.fn(),
  },
  taskAttachmentService: { list: vi.fn() },
  gitHubSyncService: {
    findPullRequestsForTask: vi.fn(),
    findExternalIssuesByProjects: vi.fn(),
    findPullRequestsByProjects: vi.fn(),
  },
  boardPreferencesService: { find: vi.fn() },
  taskTemplateService: { findVisible: vi.fn() },
}));
const board = vi.hoisted(() => ({ view: "kanban" }));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => services,
}));
vi.mock("@/app/lib/task-actions/task-actions.server", () => ({
  handleTaskAction: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));
vi.mock("@/app/components/tasks/board/use-tasks-page", () => ({
  useTasksPage: (): Record<string, unknown> => ({
    changeArchived: vi.fn(),
    isSyncing: false,
    isArchiving: false,
    isSubmittingForm: false,
    moveTask: vi.fn(),
  }),
}));
vi.mock("@/app/components/tasks/board/use-board-preferences", () => ({
  useBoardPreferences: (
    initial: BoardPreferences,
  ): Record<string, unknown> => ({
    preferences: { ...initial, view: board.view },
    update: vi.fn(),
  }),
}));
vi.mock("@/app/components/tasks/board/use-tasks-dialog", () => ({
  useTasksDialog: (selectedKey: string | null): Record<string, unknown> => ({
    selectedKey,
    openCreate: vi.fn(),
  }),
}));
vi.mock("@/app/components/tasks/board/tasks-toolbar", () => ({
  TasksToolbar: (props: {
    readonly archivedFilter: string;
  }): React.ReactElement => <p>{`toolbar ${props.archivedFilter}`}</p>,
}));
vi.mock("@/app/components/tasks/board/tasks-content", () => ({
  TasksContent: (props: {
    readonly visibleItems: readonly unknown[];
    readonly dialog: { readonly selectedKey: string | null };
  }): React.ReactElement => (
    <p>{`content ${props.visibleItems.length} ${props.dialog.selectedKey ?? "none"}`}</p>
  ),
}));
vi.mock("@/app/components/tasks/board/tasks-detail", () => ({
  TasksDetail: (props: {
    readonly selectedItem: { readonly key: string };
  }): React.ReactElement => <p>{`detail ${props.selectedItem.key}`}</p>,
}));
vi.mock("@/app/components/tasks/board/tasks-form-dialog", () => ({
  TasksFormDialog: (): React.ReactElement => <p>form dialog</p>,
}));

const ADA = { ...ACTOR, id: "u-ada", displayName: "Ada" };
const BOB = { ...ACTOR, id: "u-bob", displayName: "Bob" };
const LISTED = { id: "w-1", key: "PAGE-1" };
const OUTSIDE = { id: "w-9", key: "PAGE-9" };
const BASE = "http://pages.invalid/aufgaben";

/**
 * Loads the board for an address.
 *
 * @param query - Query of the board address.
 */
async function loadBoard(
  query = "",
): Promise<Awaited<ReturnType<typeof loader>>> {
  return loader(
    routeArguments(pagesRequest(`/aufgaben${query}`), { user: ACTOR }),
  );
}

/**
 * Revalidation arguments for a move between two board addresses.
 *
 * @param current - Query of the current address.
 * @param next - Query of the next address.
 * @param intent - Intent of a submitted form, if any.
 */
function revalidation(
  current: string,
  next: string,
  intent?: string,
): ShouldRevalidateFunctionArgs {
  const formData = new FormData();
  if (intent !== undefined) formData.set("intent", intent);
  return {
    currentUrl: new URL(`${BASE}${current}`),
    currentParams: {},
    nextUrl: new URL(`${BASE}${next}`),
    nextParams: {},
    formData: intent === undefined ? undefined : formData,
    defaultShouldRevalidate: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  board.view = "kanban";
  services.projectService.findAll.mockResolvedValue([
    { id: "p-1" },
    { id: "p-2" },
    { id: "p-3" },
  ]);
  services.taskService.canArchiveAny.mockResolvedValue(true);
  services.taskService.findAll.mockResolvedValue([LISTED]);
  services.taskService.findLabelsForWorkItems.mockResolvedValue(
    new Map([["w-1", [{ id: "l-1" }]]]),
  );
  services.taskService.findAssigneesByProjects.mockResolvedValue(
    new Map([
      ["p-1", [BOB, ADA]],
      ["p-2", [ADA]],
    ]),
  );
  services.taskService.countLabelUsage.mockResolvedValue(new Map([["l-1", 2]]));
  services.taskService.findLabels.mockResolvedValue([{ id: "l-1" }]);
  services.taskService.findAssigneeGroupIdsByProject.mockResolvedValue({});
  services.taskService.findAssigneeGroups.mockResolvedValue([]);
  services.taskService.departmentChoices.mockResolvedValue({
    available: [],
    selectionRequired: false,
  });
  services.taskService.findMilestones.mockResolvedValue([]);
  services.taskService.findAllStatuses.mockResolvedValue([]);
  services.taskService.findMemberGroupIds.mockResolvedValue(["g-1"]);
  services.taskService.actionPermissions.mockResolvedValue({ canWrite: true });
  services.taskService.getByKey.mockResolvedValue(OUTSIDE);
  services.boardPreferencesService.find.mockResolvedValue(
    DEFAULT_BOARD_PREFERENCES,
  );
  services.taskTemplateService.findVisible.mockResolvedValue([]);
  services.taskAttachmentService.list.mockResolvedValue(["attachment"]);
  services.taskService.findChecklistItems.mockResolvedValue(["check"]);
  services.taskService.describeDescendants.mockResolvedValue({ count: 0 });
  services.taskService.getHistory.mockResolvedValue(["history"]);
  services.taskService.findLinks.mockResolvedValue(["link"]);
  services.taskService.findSubtasks.mockResolvedValue(["subtask"]);
  services.gitHubSyncService.findPullRequestsForTask.mockResolvedValue(["pr"]);
});

it("reads only the known archived filters", () => {
  expect(parseArchivedFilter("archived")).toBe("archived");
  expect(parseArchivedFilter("all")).toBe("all");
  expect(parseArchivedFilter("deleted")).toBe("active");
  expect(parseArchivedFilter(null)).toBe("active");
});

it("requires the user of the authentication middleware", async () => {
  await expect(
    loader(routeArguments(pagesRequest("/aufgaben"), { user: null })),
  ).rejects.toThrow("Authenticated middleware did not provide a user.");
});

it("loads the board with sorted assignees, labels and the listed selection", async () => {
  const loaded = await loadBoard("?archived=all&item=PAGE-1");

  expect(loaded).toMatchObject({
    archivedFilter: "all",
    canFilterArchived: true,
    assignees: [ADA, BOB],
    assigneesByProject: { "p-1": [BOB, ADA], "p-2": [ADA], "p-3": [] },
    labelsByWorkItem: { "w-1": [{ id: "l-1" }] },
    labelUsage: { "l-1": 2 },
    memberGroupIds: ["g-1"],
    githubStates: [],
    selectedItem: LISTED,
    selectedAttachments: ["attachment"],
    selectedChecklist: ["check"],
    selectedDescendants: { count: 0 },
    selectedHistory: ["history"],
    selectedLinks: ["link"],
    selectedPullRequests: ["pr"],
    selectedSubtasks: ["subtask"],
  });
  expect(services.taskService.getByKey).not.toHaveBeenCalled();
  expect(services.taskService.findAll).toHaveBeenCalledWith(ACTOR, {
    archived: "all",
  });
});

it("keeps archived tickets from those who may not archive", async () => {
  services.taskService.canArchiveAny.mockResolvedValue(false);
  services.taskService.findAll.mockResolvedValue([]);

  const loaded = await loadBoard("?archived=archived");

  expect(loaded.archivedFilter).toBe("active");
  expect(loaded.selectedItem).toBeNull();
  expect(services.taskService.findLabelsForWorkItems).not.toHaveBeenCalled();
});

it("selects a listed ticket by its id as well", async () => {
  await expect(loadBoard("?item=w-1")).resolves.toMatchObject({
    selectedItem: LISTED,
  });
});

it("loads a selected ticket outside the list with its labels", async () => {
  services.taskService.findLabelsForWorkItems
    .mockResolvedValueOnce(new Map([["w-1", [{ id: "l-1" }]]]))
    .mockResolvedValueOnce(new Map([["w-9", [{ id: "l-9" }]]]));

  const loaded = await loadBoard("?item=PAGE-9");

  expect(loaded.selectedItem).toBe(OUTSIDE);
  expect(loaded.labelsByWorkItem).toEqual({
    "w-1": [{ id: "l-1" }],
    "w-9": [{ id: "l-9" }],
  });
});

it("gives a selected ticket without labels an empty list", async () => {
  services.taskService.findLabelsForWorkItems
    .mockResolvedValueOnce(new Map())
    .mockResolvedValueOnce(new Map());

  const loaded = await loadBoard("?item=PAGE-9");

  expect(loaded.labelsByWorkItem).toEqual({ "w-9": [] });
});

it("leaves the panel closed for a missing or hidden ticket", async () => {
  services.taskService.getByKey.mockRejectedValueOnce(
    new WorkItemNotFoundError(),
  );
  const missing = await loadBoard("?item=PAGE-404");
  services.taskService.getByKey.mockRejectedValueOnce(
    new ProjectAccessDeniedError(),
  );
  const hidden = await loadBoard("?item=PAGE-403");

  expect(missing.selectedItem).toBeNull();
  expect(hidden.selectedItem).toBeNull();
});

it("passes other failures of the selected ticket on", async () => {
  services.taskService.getByKey.mockRejectedValue(new Error("database"));

  await expect(loadBoard("?item=PAGE-500")).rejects.toThrow("database");
});

it("loads the GitHub states for the GitHub view", async () => {
  services.projectService.findIntegrationsByProjects.mockResolvedValue(
    new Map([["p-1", { repo: "x" }]]),
  );
  services.gitHubSyncService.findExternalIssuesByProjects.mockResolvedValue(
    new Map([["p-1", ["issue"]]]),
  );
  services.gitHubSyncService.findPullRequestsByProjects.mockResolvedValue(
    new Map([["p-1", ["pr"]]]),
  );

  const loaded = await loadBoard("?view=github");

  expect(loaded.githubStates).toEqual([
    {
      externalIssues: ["issue"],
      integration: { repo: "x" },
      project: { id: "p-1" },
      pullRequests: ["pr"],
    },
    {
      externalIssues: [],
      integration: null,
      project: { id: "p-2" },
      pullRequests: [],
    },
    {
      externalIssues: [],
      integration: null,
      project: { id: "p-3" },
      pullRequests: [],
    },
  ]);
});

it("does not reload for saved preferences or a mere view change", () => {
  expect(shouldRevalidate(revalidation("", "", "save-board-preferences"))).toBe(
    false,
  );
  expect(shouldRevalidate(revalidation("?view=list", "?view=kanban"))).toBe(
    false,
  );
});

it("reloads after changes, without board query and for another ticket", () => {
  expect(shouldRevalidate(revalidation("", "?view=list", "update-task"))).toBe(
    true,
  );
  expect(shouldRevalidate(revalidation("?view=list", ""))).toBe(true);
  expect(
    shouldRevalidate(revalidation("?view=list", "?view=list&item=PAGE-1")),
  ).toBe(true);
});

it("accepts only posts from signed-in users", async () => {
  const get = await responseOf(
    action(routeArguments(pagesRequest("/aufgaben"), { user: ACTOR })),
  );
  const anonymous = await responseOf(
    action(routeArguments(formPost("/aufgaben"), { user: null })),
  );

  expect(get.status).toBe(405);
  expect(get.headers.get("Allow")).toBe("POST");
  expect(anonymous.status).toBe(403);
});

it("hands the intent to the task actions", async () => {
  const outcome = new Response(null, { status: 204 });
  vi.mocked(handleTaskAction).mockResolvedValue(outcome);

  await expect(
    action(
      routeArguments(formPost("/aufgaben", { intent: "move-task" }), {
        user: ACTOR,
      }),
    ),
  ).resolves.toBe(outcome);
  expect(vi.mocked(handleTaskAction).mock.calls[0]?.[0]).toBe("move-task");
});

/** Loader data of the board with an optional selected ticket. */
function boardData(selectedItem: unknown): Record<string, unknown> {
  return {
    actor: ACTOR,
    projects: [],
    statuses: [],
    milestones: [],
    workItems: [],
    labelsByWorkItem: {},
    memberGroupIds: [],
    permissions: { canWrite: true },
    assigneeGroupIdsByProject: {},
    assigneeGroups: [],
    departmentChoices: { available: [] },
    archivedFilter: "active",
    board: DEFAULT_BOARD_PREFERENCES,
    githubStates: [],
    selectedItem,
  };
}

it("renders the kanban board with the open ticket panel", () => {
  renderRoute(TasksRoute, { loaderData: boardData(LISTED) });

  expect(screen.getByText("toolbar active")).toBeTruthy();
  expect(screen.getByText("content 0 PAGE-1")).toBeTruthy();
  expect(screen.getByText("detail PAGE-1")).toBeTruthy();
  expect(screen.getByText("form dialog")).toBeTruthy();
});

it("renders another view without a ticket panel", () => {
  board.view = "list";
  renderRoute(TasksRoute, { loaderData: boardData(null) });

  expect(screen.getByText("content 0 none")).toBeTruthy();
  expect(screen.queryByText(/^detail/u)).toBeNull();
});
