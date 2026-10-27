import { describe, expect, it } from "vitest";

import {
  PROJECT_SORT_FIELDS,
  PROJECT_STATUS_FILTERS,
  isProjectSortField,
  listVisibleProjects,
} from "@/app/lib/project-list-view";

import type { ProjectListView } from "@/app/lib/project-list-view";
import type { Project, ProjectStatus } from "@/definition/Project";

/** The parts of a project that the list orders, filters and searches by. */
interface ProjectSeed {
  readonly id: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly updatedAt: string;
}

function project(seed: ProjectSeed, extra: Partial<Project> = {}): Project {
  const { id, name, status, updatedAt } = seed;
  return {
    id,
    departments: [],
    parentId: null,
    name,
    description: "",
    status,
    progress: 0,
    placeholderColor: "#000000",
    hasIcon: false,
    managerId: null,
    managerName: null,
    startDate: null,
    targetDate: null,
    notes: "",
    createdAt: "2026-01-01 00:00:00",
    updatedAt,
    ...extra,
  };
}

const PROJECTS = [
  project(
    {
      id: "a",
      name: "Alpha",
      status: "paused",
      updatedAt: "2026-03-01 00:00:00",
    },
    {
      description: "Internal tooling",
      departments: [{ id: "d1", name: "Engineering" }],
    },
  ),
  project(
    {
      id: "b",
      name: "Beta",
      status: "active",
      updatedAt: "2026-01-01 00:00:00",
    },
    {
      departments: [{ id: "d2", name: "Sales" }],
    },
  ),
  project({
    id: "c",
    name: "Gamma",
    status: "completed",
    updatedAt: "2026-02-01 00:00:00",
  }),
  project({
    id: "d",
    name: "Delta",
    status: "planned",
    updatedAt: "2026-04-01 00:00:00",
  }),
];

const VIEW: ProjectListView = {
  departmentId: "",
  filter: "all",
  search: "",
  sortField: "nameAsc",
};

function names(view: Partial<ProjectListView>): string[] {
  return listVisibleProjects(PROJECTS, { ...VIEW, ...view }).map(
    (entry) => entry.name,
  );
}

describe("listing projects", () => {
  it("knows its sort fields and status filters", () => {
    expect(PROJECT_SORT_FIELDS).toHaveLength(6);
    expect(PROJECT_STATUS_FILTERS).toEqual([
      "all",
      "planned",
      "active",
      "paused",
      "completed",
    ]);
    expect(isProjectSortField("nameDesc")).toBe(true);
    expect(isProjectSortField("random")).toBe(false);
  });

  it.each([
    { sortField: "updatedDesc", expected: ["Delta", "Alpha", "Gamma", "Beta"] },
    { sortField: "updatedAsc", expected: ["Beta", "Gamma", "Alpha", "Delta"] },
    { sortField: "nameAsc", expected: ["Alpha", "Beta", "Delta", "Gamma"] },
    { sortField: "nameDesc", expected: ["Gamma", "Delta", "Beta", "Alpha"] },
    { sortField: "statusAsc", expected: ["Beta", "Delta", "Alpha", "Gamma"] },
    { sortField: "statusDesc", expected: ["Gamma", "Alpha", "Delta", "Beta"] },
  ] as const)("sorts by $sortField", ({ sortField, expected }) => {
    expect(names({ sortField })).toEqual(expected);
  });

  it("filters by status", () => {
    expect(names({ filter: "active" })).toEqual(["Beta"]);
    expect(names({ filter: "completed" })).toEqual(["Gamma"]);
  });

  it("searches name, description and department names, ignoring case and blanks", () => {
    expect(names({ search: "  ALPHA " })).toEqual(["Alpha"]);
    expect(names({ search: "tooling" })).toEqual(["Alpha"]);
    expect(names({ search: "sales" })).toEqual(["Beta"]);
    expect(names({ search: "   " })).toHaveLength(4);
    expect(names({ search: "nothing" })).toEqual([]);
  });

  it("keeps projects of one department only", () => {
    expect(names({ departmentId: "d2" })).toEqual(["Beta"]);
    expect(names({ departmentId: "unknown" })).toEqual([]);
  });

  it("combines status, search and department", () => {
    expect(
      names({ filter: "paused", search: "alpha", departmentId: "d1" }),
    ).toEqual(["Alpha"]);
    expect(names({ filter: "active", departmentId: "d1" })).toEqual([]);
  });

  it("does not reorder the given list", () => {
    const before = PROJECTS.map((entry) => entry.id);

    listVisibleProjects(PROJECTS, VIEW);

    expect(PROJECTS.map((entry) => entry.id)).toEqual(before);
  });
});
