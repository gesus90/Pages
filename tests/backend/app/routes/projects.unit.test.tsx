// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { data } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { handleProjectOverviewAction } from "@/app/lib/project-overview-actions.server";
import ProjectsRoute, { action, loader } from "@/app/routes/projects";

import {
  ACTOR,
  formPost,
  i18n,
  pagesRequest,
  renderRoute,
  responseOf,
  routeArguments,
} from "./route-fixture";

import type { ProjectActionResult } from "@/app/lib/project-overview-actions.server";

// The Frontend setup registers this cleanup; the Node scope repeats it here.
afterEach(cleanup);

const projectService = vi.hoisted(() => ({
  findAll: vi.fn(),
  findTemplates: vi.fn(),
  findArchived: vi.fn(),
  canDeleteProjects: vi.fn(),
  canCreateProjects: vi.fn(),
  departmentChoices: vi.fn(),
}));
const resetFilters = vi.hoisted(() => vi.fn());

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => ({ projectService }),
}));
vi.mock("@/app/lib/project-overview-actions.server", () => ({
  handleProjectOverviewAction: vi.fn(),
}));
vi.mock("@/app/components/projects/overview/use-project-list-view", () => ({
  useProjectListView: (
    projects: readonly { readonly id: string }[],
  ): Record<string, unknown> => ({
    departments: [],
    departmentId: "",
    filter: "all",
    search: "",
    sortField: "updatedDesc",
    visibleProjects: projects,
    setDepartmentId: vi.fn(),
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSortField: vi.fn(),
    resetFilters,
  }),
}));
vi.mock("@/app/components/projects/overview/create-project-dialog", () => ({
  CreateProjectDialog: (props: {
    readonly canManageProjects: boolean;
  }): React.ReactElement => (
    <p>{`create ${String(props.canManageProjects)}`}</p>
  ),
}));
vi.mock("@/app/components/projects/overview/projects-toolbar", () => ({
  ProjectsToolbar: (): React.ReactElement => <p>toolbar</p>,
}));
vi.mock("@/app/components/projects/overview/projects-content", () => ({
  ProjectsContent: (props: {
    readonly visibleProjects: readonly { readonly id: string }[];
    readonly hasProjects: boolean;
  }): React.ReactElement => (
    <p>{`active ${props.visibleProjects.map((project) => project.id).join(",")} ${String(props.hasProjects)}`}</p>
  ),
}));
vi.mock("@/app/components/projects/overview/archived-projects-content", () => ({
  ArchivedProjectsContent: (props: {
    readonly projects: readonly { readonly id: string }[];
    readonly canDelete: boolean;
  }): React.ReactElement => (
    <p>{`archived ${props.projects.map((project) => project.id).join(",")} ${String(props.canDelete)}`}</p>
  ),
}));

const LOADED = {
  templates: [],
  archivedProjects: [{ id: "old" }],
  canDeleteProjects: true,
  canManageProjects: false,
  projects: [{ id: "p-1" }],
  departmentChoices: { available: [], selectionRequired: false },
};

beforeEach(() => {
  resetFilters.mockReset();
  vi.mocked(handleProjectOverviewAction).mockReset();
});

it("requires the user of the authentication middleware", async () => {
  await expect(
    loader(routeArguments(pagesRequest("/projekte"), { user: null })),
  ).rejects.toThrow("Authenticated middleware did not provide a user.");
});

it("loads active and archived projects with the visitor's rights", async () => {
  projectService.findAll.mockResolvedValue([{ id: "p-1" }]);
  projectService.findTemplates.mockResolvedValue([]);
  projectService.findArchived.mockResolvedValue([{ id: "old" }]);
  projectService.canDeleteProjects.mockResolvedValue(true);
  projectService.canCreateProjects.mockResolvedValue(false);
  projectService.departmentChoices.mockResolvedValue(LOADED.departmentChoices);

  await expect(
    loader(routeArguments(pagesRequest("/projekte"), { user: ACTOR })),
  ).resolves.toEqual(LOADED);
  expect(projectService.findAll).toHaveBeenCalledWith(ACTOR);
});

it("accepts only posts", async () => {
  const response = await responseOf(
    action(routeArguments(pagesRequest("/projekte"), { user: ACTOR })),
  );

  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("POST");
});

it("refuses a post without a signed-in user", async () => {
  const response = await responseOf(
    action(routeArguments(formPost("/projekte"), { user: null })),
  );

  expect(response.status).toBe(403);
});

it("hands the intent to the overview actions", async () => {
  const outcome = data<ProjectActionResult>({
    ok: true,
    intent: "create-project",
    projectId: "p-9",
  });
  vi.mocked(handleProjectOverviewAction).mockResolvedValue(outcome);

  await expect(
    action(
      routeArguments(formPost("/projekte", { intent: "create-project" }), {
        user: ACTOR,
      }),
    ),
  ).resolves.toBe(outcome);
  const [call] = vi.mocked(handleProjectOverviewAction).mock.calls;
  expect(call?.[0]).toBe("create-project");
  expect(call?.[1].actor).toBe(ACTOR);
});

it("switches between active and archived projects", async () => {
  renderRoute(ProjectsRoute, { loaderData: LOADED });

  expect(screen.getByRole("heading").textContent).toBe(
    i18n.t("projects.title"),
  );
  expect(screen.getByText("create false")).toBeTruthy();
  expect(screen.getByText("active p-1 true")).toBeTruthy();

  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("projects.lifecycle.archiveView"),
    }),
  );
  expect(await screen.findByText("archived old true")).toBeTruthy();
  expect(resetFilters).toHaveBeenCalledTimes(1);

  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("projects.lifecycle.active") }),
  );
  expect(await screen.findByText("active p-1 true")).toBeTruthy();
});

it("tells the active list when there are no projects at all", () => {
  renderRoute(ProjectsRoute, {
    loaderData: { ...LOADED, projects: [] },
    url: "/?archiv=0",
  });

  expect(screen.getByText("active false")).toBeTruthy();
});
