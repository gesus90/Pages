// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { data } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { handleProjectAction } from "@/app/lib/project-actions/project-actions.server";
import { handleProjectScopeAction } from "@/app/lib/project-actions/project-scope-actions.server";
import ProjectDetailRoute, {
  action,
  loader,
} from "@/app/routes/project-detail";
import {
  ProjectAccessDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";

import {
  ACTOR,
  formPost,
  pagesRequest,
  renderRoute,
  responseOf,
  routeArgumentsWith,
} from "./route-fixture";

import type { ProjectDetailActionResult } from "@/app/lib/project-actions/project-action-support.server";

// The Frontend setup registers this cleanup; the Node scope repeats it here.
afterEach(cleanup);

const services = vi.hoisted(() => ({
  projectService: {
    getById: vi.fn(),
    permissions: vi.fn(),
    departmentChoices: vi.fn(),
    findMembers: vi.fn(),
    findGoals: vi.fn(),
    findTags: vi.fn(),
    findEvents: vi.fn(),
    findIntegration: vi.fn(),
    findActivity: vi.fn(),
    canWriteProject: vi.fn(),
  },
  taskService: {
    findMilestones: vi.fn(),
    findDependencies: vi.fn(),
    findAll: vi.fn(),
    findHistoryByProject: vi.fn(),
    canArchive: vi.fn(),
    findEligibleAssignees: vi.fn(),
  },
  discordConnectionService: { isConnected: vi.fn() },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => services,
}));
vi.mock("@/app/lib/project-actions/project-actions.server", () => ({
  handleProjectAction: vi.fn(),
}));
vi.mock("@/app/lib/project-actions/project-scope-actions.server", () => ({
  handleProjectScopeAction: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));
vi.mock("@/app/components/ui/horizontal-scroll-area", () => ({
  HorizontalScrollArea: (props: {
    readonly children: React.ReactNode;
  }): React.ReactElement => <div>{props.children}</div>,
}));
vi.mock("@/app/components/ui/vertical-scroll-area", () => ({
  VerticalScrollArea: (props: {
    readonly children: React.ReactNode;
  }): React.ReactElement => <div>{props.children}</div>,
}));
vi.mock("@/app/components/ui/tabs", () => ({
  Tabs: (props: {
    readonly value: string;
    readonly onValueChange: (value: string) => void;
    readonly tabs: readonly {
      readonly value: string;
      readonly label: string;
    }[];
  }): React.ReactElement => (
    <nav aria-label={props.value}>
      {props.tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => props.onValueChange(tab.value)}
        >
          {tab.value}
        </button>
      ))}
    </nav>
  ),
}));
vi.mock("@/app/components/projects/project-header", () => ({
  ProjectHeader: (props: {
    readonly project: { readonly name: string };
  }): React.ReactElement => <h1>{props.project.name}</h1>,
}));
vi.mock("@/app/components/projects/project-general-tab", () => ({
  ProjectGeneralTab: (): React.ReactElement => <p>general tab</p>,
}));
vi.mock("@/app/components/projects/project-team-tab", () => ({
  ProjectTeamTab: (): React.ReactElement => <p>team tab</p>,
}));
vi.mock("@/app/components/projects/project-planning-tab", () => ({
  ProjectPlanningTab: (): React.ReactElement => <p>planning tab</p>,
}));
vi.mock("@/app/components/projects/project-integrations-tab", () => ({
  ProjectIntegrationsTab: (): React.ReactElement => <p>integrations tab</p>,
}));
vi.mock("@/app/components/projects/project-activity-tab", () => ({
  ProjectActivityTab: (): React.ReactElement => <p>activity tab</p>,
}));

const PROJECT = { id: "p-1", name: "Pages" };
const NO_DEPARTMENTS = { available: [], selectionRequired: false };

/**
 * Loader or action arguments of the project page.
 *
 * @param request - The request.
 * @param options - Project id of the address and the signed-in user.
 */
function projectArguments(
  request: Request,
  options: {
    readonly projectId?: string;
    readonly user?: typeof ACTOR | null;
  } = {},
): ReturnType<typeof routeArgumentsWith<{ projectId: string }>> {
  return routeArgumentsWith(
    request,
    { projectId: options.projectId ?? "p-1" },
    { user: options.user === undefined ? ACTOR : options.user },
  );
}

/**
 * Loads the page with one tab selected.
 *
 * @param tab - The `tab` query value, if any.
 */
async function loadTab(
  tab?: string,
): Promise<Awaited<ReturnType<typeof loader>>> {
  return loader(
    projectArguments(
      pagesRequest(`/projekte/p-1${tab === undefined ? "" : `?tab=${tab}`}`),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  services.projectService.getById.mockResolvedValue(PROJECT);
  services.projectService.permissions.mockResolvedValue({
    canChangeDepartments: false,
  });
  services.projectService.departmentChoices.mockResolvedValue({
    available: [{ id: "d-1" }],
    selectionRequired: true,
  });
  services.projectService.findMembers.mockResolvedValue([{ id: "m-1" }]);
  services.projectService.findGoals.mockResolvedValue([{ id: "g-1" }]);
  services.projectService.findTags.mockResolvedValue(["tag"]);
  services.projectService.findEvents.mockResolvedValue([{ id: "e-1" }]);
  services.projectService.findIntegration.mockResolvedValue({ repo: "x" });
  services.projectService.findActivity.mockResolvedValue([{ id: "a-1" }]);
  services.projectService.canWriteProject.mockResolvedValue(true);
  services.taskService.findMilestones.mockResolvedValue([{ id: "ms-1" }]);
  services.taskService.findDependencies.mockResolvedValue([{ id: "dep" }]);
  services.taskService.findAll.mockResolvedValue([{ id: "t-1" }]);
  services.taskService.findHistoryByProject.mockResolvedValue([{ id: "h" }]);
  services.taskService.canArchive.mockResolvedValue(true);
  services.taskService.findEligibleAssignees.mockResolvedValue([ACTOR]);
  services.discordConnectionService.isConnected.mockResolvedValue(true);
});

it("requires the user of the authentication middleware", async () => {
  await expect(
    loader(projectArguments(pagesRequest("/projekte/p-1"), { user: null })),
  ).rejects.toThrow("Authenticated middleware did not provide a user.");
});

it("answers an address without project with not found", async () => {
  const response = await responseOf(
    loader(projectArguments(pagesRequest("/projekte"), { projectId: "" })),
  );

  expect(response.status).toBe(404);
});

it("loads only the general tab's data by default", async () => {
  const loaded = await loadTab("unknown");

  expect(loaded).toMatchObject({
    activeTab: "general",
    project: PROJECT,
    departmentChoices: NO_DEPARTMENTS,
    members: [{ id: "m-1" }],
    goals: [{ id: "g-1" }],
    tags: ["tag"],
    events: [{ id: "e-1" }],
    milestones: [{ id: "ms-1" }],
    workItems: [{ id: "t-1" }],
    milestoneLinks: [],
    activity: [],
    taskHistory: [],
    integration: null,
    discordConnected: false,
    canWrite: true,
    canArchiveMilestones: false,
    eligibleUsers: [],
    statuses: [],
  });
  expect(services.projectService.departmentChoices).not.toHaveBeenCalled();
  await expect(loadTab()).resolves.toMatchObject({ activeTab: "general" });
});

it("loads the team with the users who may join", async () => {
  services.projectService.permissions.mockResolvedValue({
    canChangeDepartments: true,
  });

  const loaded = await loadTab("team");

  expect(loaded).toMatchObject({
    activeTab: "team",
    members: [{ id: "m-1" }],
    goals: [],
    eligibleUsers: [ACTOR],
    departmentChoices: { available: [{ id: "d-1" }], selectionRequired: true },
  });
});

it("offers nobody when the lookup of joinable users fails", async () => {
  services.taskService.findEligibleAssignees.mockRejectedValue(new Error("x"));

  await expect(loadTab("team")).resolves.toMatchObject({ eligibleUsers: [] });
});

it("loads the planning with dependencies and the archive hint", async () => {
  await expect(loadTab("planning")).resolves.toMatchObject({
    activeTab: "planning",
    members: [],
    milestoneLinks: [{ id: "dep" }],
    events: [{ id: "e-1" }],
    canArchiveMilestones: true,
  });
});

it("loads the integrations with the Discord status", async () => {
  await expect(loadTab("integrations")).resolves.toMatchObject({
    activeTab: "integrations",
    integration: { repo: "x" },
    discordConnected: true,
    workItems: [],
  });
});

it("loads the activity with the ticket history", async () => {
  await expect(loadTab("activity")).resolves.toMatchObject({
    activeTab: "activity",
    activity: [{ id: "a-1" }],
    taskHistory: [{ id: "h" }],
    milestones: [],
  });
});

it("answers a missing or hidden project with not found or forbidden", async () => {
  services.projectService.getById.mockRejectedValueOnce(
    new ProjectNotFoundError(),
  );
  const missing = await responseOf(loadTab());
  services.projectService.getById.mockRejectedValueOnce(
    new ProjectAccessDeniedError(),
  );
  const hidden = await responseOf(loadTab());

  expect(missing.status).toBe(404);
  expect(hidden.status).toBe(403);
});

it("passes other loading failures on", async () => {
  services.projectService.getById.mockRejectedValue(new Error("database"));

  await expect(loadTab()).rejects.toThrow("database");
});

it("accepts only posts from signed-in users on a project", async () => {
  const get = await responseOf(
    action(projectArguments(pagesRequest("/projekte/p-1"))),
  );
  const anonymous = await responseOf(
    action(projectArguments(formPost("/projekte/p-1"), { user: null })),
  );
  const withoutProject = await responseOf(
    action(projectArguments(formPost("/projekte"), { projectId: "" })),
  );

  expect(get.status).toBe(405);
  expect(anonymous.status).toBe(403);
  expect(withoutProject.status).toBe(404);
});

it("lets the scope actions answer first", async () => {
  const scoped = new Response(null, { status: 204 });
  vi.mocked(handleProjectScopeAction).mockResolvedValue(scoped);

  await expect(
    action(projectArguments(formPost("/projekte/p-1", { intent: "scope" }))),
  ).resolves.toBe(scoped);
  expect(handleProjectAction).not.toHaveBeenCalled();
});

it("hands other intents to the project actions", async () => {
  const outcome = data<ProjectDetailActionResult>({ ok: true });
  vi.mocked(handleProjectScopeAction).mockResolvedValue(undefined);
  vi.mocked(handleProjectAction).mockResolvedValue(outcome);

  await expect(
    action(projectArguments(formPost("/projekte/p-1", { intent: "rename" }))),
  ).resolves.toBe(outcome);
  const [intent, context] = vi.mocked(handleProjectAction).mock.calls[0] ?? [];
  expect(intent).toBe("rename");
  expect(context?.projectId).toBe("p-1");
});

it("turns a failed action into an error answer", async () => {
  vi.mocked(handleProjectScopeAction).mockRejectedValue(
    new ProjectAccessDeniedError(),
  );

  await expect(
    action(projectArguments(formPost("/projekte/p-1", { intent: "x" }))),
  ).resolves.toMatchObject({ data: { error: "forbidden", ok: false } });
});

it("switches between the tabs through the address", async () => {
  renderRoute(ProjectDetailRoute, {
    loaderData: { project: PROJECT, activeTab: "general", canWrite: true },
  });

  expect(screen.getByRole("heading").textContent).toBe("Pages");
  expect(screen.getByText("general tab")).toBeTruthy();
  for (const tab of ["team", "planning", "integrations", "activity"]) {
    fireEvent.click(screen.getByRole("button", { name: tab }));
    expect(await screen.findByText(`${tab} tab`)).toBeTruthy();
  }
  fireEvent.click(screen.getByRole("button", { name: "general" }));
  expect(await screen.findByText("general tab")).toBeTruthy();
});

it("falls back to the loaded tab for an unknown address tab", () => {
  renderRoute(ProjectDetailRoute, {
    loaderData: { project: PROJECT, activeTab: "activity" },
    url: "/?tab=unknown",
  });

  expect(screen.getByText("activity tab")).toBeTruthy();
});
