import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import { PROJECT_DELETION_COUNT_KEYS } from "@/definition/AgentProjectDeletion";

import { ProjectWorld } from "./project-service-world";

import type { ProjectDeletionDetails } from "@/backend/database/repositories/ProjectRepository";
import type { ProjectDeletionEffects } from "@/backend/service/project/ProjectDeletionService";

let world = new ProjectWorld();
beforeEach(() => {
  world = new ProjectWorld();
});

describe("action hints", () => {
  it("grants every hint to an administrator", async () => {
    await expect(
      world.service.permissions(world.user("admin"), "alpha"),
    ).resolves.toEqual({
      canEditGeneral: true,
      canChangeDepartments: true,
      canArchive: true,
      canDelete: true,
    });
  });

  it("grants editing, assignments and archiving to a co-owner but not deleting", async () => {
    await expect(
      world.service.permissions(world.user("lead"), "alpha"),
    ).resolves.toEqual({
      canEditGeneral: true,
      canChangeDepartments: true,
      canArchive: true,
      canDelete: false,
    });
  });

  it("grants nothing to a reader", async () => {
    await expect(
      world.service.permissions(world.user("writer"), "alpha"),
    ).resolves.toEqual({
      canEditGeneral: false,
      canChangeDepartments: false,
      canArchive: false,
      canDelete: false,
    });
  });

  it("grants nothing for a project without access", async () => {
    world.manage("alpha", "outsider");

    await expect(
      world.service.permissions(world.user("outsider"), "alpha"),
    ).resolves.toEqual({
      canEditGeneral: false,
      canChangeDepartments: false,
      canArchive: false,
      canDelete: false,
    });
  });

  it("offers only deletion for an archived project", async () => {
    world.archive("alpha");

    await expect(
      world.service.permissions(world.user("admin"), "alpha"),
    ).resolves.toEqual({
      canEditGeneral: false,
      canChangeDepartments: false,
      canArchive: false,
      canDelete: true,
    });
  });

  it("reports a project that does not exist at all", async () => {
    await expect(
      world.service.permissions(world.user("admin"), "missing"),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });
});

describe("department assignment", () => {
  it("replaces the departments and forgets every dependent cache", async () => {
    const invalidations = [
      vi.spyOn(world.cache, "invalidateProject"),
      vi.spyOn(world.cache, "invalidateProjectMembership"),
      vi.spyOn(world.cache, "invalidateWorkItems"),
      vi.spyOn(world.cache, "invalidateLabels"),
      vi.spyOn(world.cache, "invalidateGitHub"),
    ];

    await world.service.setDepartments(world.user("admin"), "alpha", [
      "design",
    ]);

    expect(world.state.departmentWrites.get("alpha")).toEqual(["design"]);
    for (const invalidation of invalidations)
      expect(invalidation).toHaveBeenCalled();
  });

  it("drops duplicates", async () => {
    await world.service.setDepartments(world.user("lead"), "alpha", [
      "engineering",
      "engineering",
    ]);

    expect(world.state.departmentWrites.get("alpha")).toEqual(["engineering"]);
  });

  it("refuses a reader before looking at the selection", async () => {
    await expect(
      world.service.setDepartments(world.user("writer"), "alpha", ["ghost"]),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    expect(world.writes).toEqual([]);
  });

  it("refuses a co-owner who does not manage every current department", async () => {
    world.addProject("both", ["engineering", "design"]);

    await expect(
      world.service.setDepartments(world.user("lead"), "both", ["engineering"]),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
  });

  it("requires a department while departments exist", async () => {
    await expect(
      world.service.setDepartments(world.user("lead"), "alpha", []),
    ).rejects.toMatchObject({ code: "departmentRequired" });
  });

  it("rejects an unknown department", async () => {
    await expect(
      world.service.setDepartments(world.user("lead"), "alpha", ["ghost"]),
    ).rejects.toMatchObject({ code: "invalidDepartment" });
  });

  it("rejects a department the actor does not manage", async () => {
    await expect(
      world.service.setDepartments(world.user("lead"), "alpha", ["design"]),
    ).rejects.toMatchObject({ code: "departmentOutOfScope" });
    expect(world.state.departmentWrites.size).toBe(0);
  });

  it("refuses an actor without access to the project", async () => {
    await expect(
      world.service.setDepartments(world.user("outsider"), "alpha", ["design"]),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });
});

describe("archiving", () => {
  it("moves the project to the archive and forgets caches", async () => {
    const invalidate = vi.spyOn(world.cache, "invalidateWorkItems");

    await world.service.archive(world.user("lead"), "alpha");

    expect(world.state.projects.has("alpha")).toBe(false);
    expect(world.state.archived.has("alpha")).toBe(true);
    expect(invalidate).toHaveBeenCalled();
  });

  it("needs the archive capability itself", async () => {
    world.addPerson("manager", {
      capabilities: ["manage_projects"],
      managedDepartments: ["engineering"],
    });

    await expect(
      world.service.archive(world.user("manager"), "alpha"),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    expect(world.state.projects.has("alpha")).toBe(true);
  });

  it("needs the complete scope of the project", async () => {
    world.addProject("both", ["engineering", "design"]);

    await expect(
      world.service.archive(world.user("lead"), "both"),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
  });

  it("refuses a project without access and a repeated archive", async () => {
    await expect(
      world.service.archive(world.user("outsider"), "alpha"),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);

    await world.service.archive(world.user("admin"), "alpha");

    await expect(
      world.service.archive(world.user("admin"), "alpha"),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });
});

describe("archive listing", () => {
  beforeEach(() => {
    world.addProject("beta", ["design"]);
    world.archive("alpha");
    world.archive("beta");
  });

  it("lists archived projects of the own departments", async () => {
    const archived = await world.service.findArchived(world.user("writer"));

    expect(archived.map((project) => project.id)).toEqual(["alpha"]);
  });

  it("lists every archived project in administrator mode", async () => {
    const archived = await world.service.findArchived(world.user("admin"));

    expect(archived.map((project) => project.id).sort()).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("offers deletion controls only in administrator mode", async () => {
    await expect(
      world.service.canDeleteProjects(world.user("admin")),
    ).resolves.toBe(true);
    await expect(
      world.service.canDeleteProjects(world.user("lead")),
    ).resolves.toBe(false);
  });
});

describe("permanent deletion", () => {
  function details(): ProjectDeletionDetails {
    const counts = Object.fromEntries(
      PROJECT_DELETION_COUNT_KEYS.map((key) => [key, 0]),
    ) as ProjectDeletionDetails["scope"]["counts"];

    return {
      memberIds: [],
      scope: {
        project: {
          id: "alpha",
          name: "alpha",
          status: "active",
          isArchived: false,
          departmentNames: ["engineering"],
        },
        counts,
        detached: {
          templateAssignments: 0,
          wikiAnchors: 0,
          wikiLinks: 0,
          boardPreferences: 0,
        },
      },
    };
  }

  function effects(): ProjectDeletionEffects {
    return {
      stopRuns: vi.fn(async () => undefined),
      removeFiles: vi.fn(async () => undefined),
    };
  }

  it("refuses everyone but an administrator without stopping plan runs", async () => {
    const attached = effects();
    world.service.setDeletionEffects(attached);
    const deletion = vi.spyOn(ProjectRepository.prototype, "deletePermanently");

    await expect(
      world.service.deletePermanently(world.user("lead"), "alpha"),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);

    expect(attached.stopRuns).not.toHaveBeenCalled();
    expect(deletion).not.toHaveBeenCalled();
  });

  it("stops the runs, deletes, then removes the files", async () => {
    const attached = effects();
    const order: string[] = [];
    vi.mocked(attached.stopRuns).mockImplementation(async () => {
      order.push("stop");
    });
    world.service.setDeletionEffects(attached);
    vi.spyOn(ProjectRepository.prototype, "describeDeletion").mockResolvedValue(
      details(),
    );
    vi.spyOn(
      ProjectRepository.prototype,
      "deletePermanently",
    ).mockImplementation(async () => {
      order.push("delete");
      return {
        agentRunRecords: [],
        ticketAttachments: ["file"],
        wikiAttachments: [],
      };
    });

    await world.service.deletePermanently(world.user("admin"), "alpha");

    expect(order).toEqual(["stop", "delete"]);
    expect(attached.removeFiles).toHaveBeenCalledWith({
      agentRunRecords: [],
      ticketAttachments: ["file"],
      wikiAttachments: [],
    });
  });
});
