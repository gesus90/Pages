import { beforeEach, describe, expect, it } from "vitest";

import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import { PROJECT_STATUS } from "@/definition/Project";

import { ProjectWorld } from "./project-service-world";

import type { NewProject } from "@/backend/database/repositories/ProjectRepository";
import type { ProjectTemplate } from "@/definition/Project";

let world = new ProjectWorld();
beforeEach(() => {
  world = new ProjectWorld();
});

function template(overrides: Partial<ProjectTemplate> = {}): ProjectTemplate {
  return {
    id: "template-1",
    projectId: "alpha",
    name: "Snapshot",
    description: "Template description",
    status: PROJECT_STATUS.PLANNED,
    goals: ["Plan", "Ship"],
    tags: ["web", "launch"],
    ...overrides,
  };
}

function request(overrides: Partial<NewProject> = {}): NewProject {
  return {
    id: "from-template",
    name: "Spring launch",
    description: "ignored description",
    ownerId: "ignored",
    placeholderColor: "#336699",
    status: PROJECT_STATUS.COMPLETED,
    departmentIds: ["engineering"],
    ...overrides,
  };
}

describe("saving a template", () => {
  beforeEach(() => {
    world.state.goals.set("alpha", [
      {
        id: "g1",
        projectId: "alpha",
        title: "Plan",
        isDone: false,
        position: 0,
      },
      {
        id: "g2",
        projectId: "alpha",
        title: "Ship",
        isDone: true,
        position: 1,
      },
    ]);
    world.state.tags.set("alpha", ["web"]);
  });

  it("snapshots the general information, goal titles and tags", async () => {
    await world.service.saveTemplate(world.user("lead"), "alpha");

    expect(world.state.templates).toMatchObject([
      {
        projectId: "alpha",
        name: "alpha",
        description: "Synthetic project",
        status: "active",
        goals: ["Plan", "Ship"],
        tags: ["web"],
      },
    ]);
  });

  it("refreshes the single snapshot of a project", async () => {
    await world.service.saveTemplate(world.user("lead"), "alpha");
    const firstId = world.state.templates[0]?.id;
    world.state.tags.set("alpha", ["web", "api"]);

    await world.service.saveTemplate(world.user("lead"), "alpha");

    expect(world.state.templates).toHaveLength(1);
    expect(world.state.templates[0]).toMatchObject({
      id: firstId,
      tags: ["web", "api"],
    });
  });

  it("refuses a reader without responsibility", async () => {
    await expect(
      world.service.saveTemplate(world.user("writer"), "alpha"),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    expect(world.state.templates).toEqual([]);
  });

  it("refuses a project without access", async () => {
    await expect(
      world.service.saveTemplate(world.user("outsider"), "alpha"),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });

  it("reports a missing project", async () => {
    await expect(
      world.service.saveTemplate(world.user("admin"), "missing"),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });
});

describe("listing templates", () => {
  beforeEach(() => {
    world.addProject("beta", ["design"]);
    world.state.templates = [
      template({ id: "t-alpha", projectId: "alpha" }),
      template({ id: "t-beta", projectId: "beta" }),
      template({ id: "t-gone", projectId: "deleted" }),
    ];
  });

  it("shows templates of reachable source projects only", async () => {
    const templates = await world.service.findTemplates(world.user("writer"));

    expect(templates.map((entry) => entry.id)).toEqual(["t-alpha"]);
  });

  it("keeps a template whose source was archived", async () => {
    world.archive("beta");

    const templates = await world.service.findTemplates(world.user("outsider"));

    expect(templates.map((entry) => entry.id)).toEqual(["t-beta"]);
  });

  it("hides templates of deleted sources even from an administrator", async () => {
    const templates = await world.service.findTemplates(world.user("admin"));

    expect(templates.map((entry) => entry.id).sort()).toEqual([
      "t-alpha",
      "t-beta",
    ]);
  });
});

describe("creating from a template", () => {
  beforeEach(() => {
    world.state.templates = [template()];
  });

  it("takes description and status from the template and copies goals and tags", async () => {
    const canOpen = await world.service.createFromTemplate(
      world.user("lead"),
      "template-1",
      request(),
    );

    expect(canOpen).toBe(true);
    expect(world.project("from-template")).toMatchObject({
      name: "Spring launch",
      description: "Template description",
      status: "planned",
    });
    expect(
      world.state.goals
        .get("from-template")
        ?.map((goal) => [goal.title, goal.position]),
    ).toEqual([
      ["Plan", 0],
      ["Ship", 1],
    ]);
    expect(world.state.tags.get("from-template")).toEqual(["web", "launch"]);
  });

  it("reports an unknown template", async () => {
    await expect(
      world.service.createFromTemplate(world.user("lead"), "nope", request()),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it("refuses a template whose source the actor cannot reach", async () => {
    world.addPerson("global", {
      capabilities: ["manage_projects"],
      managedDepartments: ["engineering"],
      departments: ["design"],
    });

    await expect(
      world.service.createFromTemplate(
        world.user("global"),
        "template-1",
        request(),
      ),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
    expect(world.writes).toEqual([]);
  });

  it("applies the creation rules and writes nothing when they refuse", async () => {
    await expect(
      world.service.createFromTemplate(
        world.user("writer"),
        "template-1",
        request(),
      ),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    expect(world.writes).toEqual([]);
    expect(world.state.goals.has("from-template")).toBe(false);
  });

  it("rejects departments outside the responsibility of the actor", async () => {
    await expect(
      world.service.createFromTemplate(
        world.user("lead"),
        "template-1",
        request({ departmentIds: ["design"] }),
      ),
    ).rejects.toMatchObject({ code: "departmentOutOfScope" });
    expect(world.state.projects.has("from-template")).toBe(false);
  });
});
