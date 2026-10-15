import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectPolicyService } from "@/backend/auth/ProjectPolicyService";
import { PermissionService } from "@/backend/auth/PermissionService";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import { ProjectService } from "@/backend/service/ProjectService";
import { ProjectDeletionService } from "@/backend/service/project/ProjectDeletionService";
import { ProjectManagementService } from "@/backend/service/project/ProjectManagementService";

import { archiveAccount } from "../agents/archive-records";
import { ProjectDeletionWorld } from "./project-deletion-world";

import type { ActorChannel } from "@/backend/auth/McpActorContext";
import type { User } from "@/definition/User";

let world = new ProjectDeletionWorld();
beforeEach(() => {
  world = new ProjectDeletionWorld();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function repository(): ProjectRepository {
  return new ProjectRepository({ ...world.connection, ...world.database() });
}

function deletion(channel: ActorChannel): ProjectDeletionService {
  return new ProjectDeletionService(repository(), world.cache, channel);
}

function actor(id: string): User {
  const user = world.users.get(id);
  if (!user) throw new Error(`Unknown synthetic user ${id}`);
  return user;
}

describe("ProjectPolicyService.canDeleteProject", () => {
  const policy = new ProjectPolicyService();
  const departments = ["engineering"];

  it("allows the administrator in the active administrator mode", () => {
    expect(
      policy.canDeleteProject(
        archiveAccount("a", { isAdmin: true, mode: "admin", capabilities: [] }),
        departments,
      ),
    ).toBe(true);
  });

  it.each([
    [
      "an administrator working in the role mode",
      { isAdmin: true, mode: "role" as const },
    ],
    [
      "a manager of all projects",
      {
        capabilities: ["write", "manage_projects", "archive_projects"] as const,
        allProjects: true,
      },
    ],
    [
      "a manager of the project's department",
      {
        capabilities: ["manage_projects", "archive_projects"] as const,
        managedDepartments: ["engineering"],
      },
    ],
    ["a writer", { capabilities: ["write"] as const }],
    [
      "an inactive administrator",
      { isAdmin: true, mode: "admin" as const, isActive: false },
    ],
  ])("refuses %s", (label, options) => {
    expect(
      policy.canDeleteProject(archiveAccount("p", options), departments),
    ).toBe(false);
  });

  it("does not depend on the departments of the project for the administrator", () => {
    const account = archiveAccount("a", {
      isAdmin: true,
      mode: "admin",
      departments: [],
    });
    expect(policy.canDeleteProject(account, ["design"])).toBe(true);
    expect(policy.canDeleteProject(account, [])).toBe(true);
  });
});

describe.each(["ui", "mcp"] as const)(
  "ProjectDeletionService on the %s channel",
  (channel) => {
    const administrator = channel === "ui" ? "uiadmin" : "admin";

    it("deletes the project and reports what went and which files are left", async () => {
      const outcome = await deletion(channel).delete(
        actor(administrator),
        "alpha",
      );
      expect(outcome.scope.project.id).toBe("alpha");
      expect(outcome.scope.counts.tickets).toBe(4);
      expect(outcome.memberIds).toEqual(["writer"]);
      expect(outcome.files.ticketAttachments).toEqual(["alpha-ticket-file"]);
      expect(world.projects.has("alpha")).toBe(false);
      expect(world.projects.has("beta")).toBe(true);
    });

    it("describes without deleting", async () => {
      const details = await deletion(channel).describe(
        actor(administrator),
        "beta",
      );
      expect(details.scope.counts.tickets).toBe(9);
      expect(world.projects.has("beta")).toBe(true);
      expect(world.steps).toEqual([]);
    });

    it("deletes an archived project", async () => {
      world.archive("alpha");
      const outcome = await deletion(channel).delete(
        actor(administrator),
        "alpha",
      );
      expect(outcome.scope.project.isArchived).toBe(true);
      expect(world.projects.has("alpha")).toBe(false);
    });

    it.each(["manager", "writer"])(
      "refuses %s before looking at the project",
      async (userId) => {
        const lookup = vi.spyOn(ProjectRepository.prototype, "findById");
        await expect(
          deletion(channel).delete(actor(userId), "alpha"),
        ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
        await expect(
          deletion(channel).describe(actor(userId), "nowhere"),
        ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
        await expect(
          deletion(channel).authorize(actor(userId), "alpha"),
        ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
        expect(lookup).not.toHaveBeenCalled();
        expect(world.projects.has("alpha")).toBe(true);
      },
    );

    it("reports a project that does not exist, and a second deletion finds nothing", async () => {
      await expect(
        deletion(channel).delete(actor(administrator), "nowhere"),
      ).rejects.toBeInstanceOf(ProjectNotFoundError);
      await deletion(channel).delete(actor(administrator), "alpha");
      const deleted = vi.spyOn(
        ProjectRepository.prototype,
        "deletePermanently",
      );
      deleted.mockClear();
      await expect(
        deletion(channel).delete(actor(administrator), "alpha"),
      ).rejects.toBeInstanceOf(ProjectNotFoundError);
      expect(deleted).not.toHaveBeenCalled();
    });

    it("refuses an inactive account", async () => {
      world.addPerson("sleeper", {
        isAdmin: true,
        mode: "admin",
        isActive: false,
      });
      await expect(
        deletion(channel).delete(actor("sleeper"), "alpha"),
      ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
    });

    it("rolls the data back when the deletion fails", async () => {
      world.failDeletionWith = new Error("disk full");
      await expect(
        deletion(channel).delete(actor(administrator), "alpha"),
      ).rejects.toThrow("disk full");
      expect(world.projects.has("alpha")).toBe(true);
      expect(world.data.get("alpha")?.tickets).toBe(4);
    });
  },
);

describe("the two channels read the administrator differently", () => {
  it("lets the personal administrator delete over MCP but not while working in the role mode of the interface", async () => {
    await expect(
      deletion("ui").delete(actor("admin"), "alpha"),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    expect(world.projects.has("alpha")).toBe(true);
    await expect(
      deletion("mcp").delete(actor("admin"), "alpha"),
    ).resolves.toMatchObject({ scope: { project: { id: "alpha" } } });
  });
});

describe("ProjectDeletionService.deleteWithEffects", () => {
  it("stops the runs, deletes, forgets the project and removes the files in that order", async () => {
    const forgotten = vi
      .spyOn(world.cache, "invalidateProject")
      .mockImplementation(() => {
        world.steps.push("cache");
      });
    await deletion("ui").deleteWithEffects(
      actor("uiadmin"),
      "alpha",
      world.effects,
    );
    expect(world.steps).toEqual([
      "stop:alpha",
      "delete:alpha",
      "cache",
      "files",
    ]);
    expect(forgotten).toHaveBeenCalledWith("alpha");
  });

  it("refuses before it stops anything", async () => {
    await expect(
      deletion("ui").deleteWithEffects(
        actor("manager"),
        "alpha",
        world.effects,
      ),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    expect(world.effects.stopRuns).not.toHaveBeenCalled();
    expect(world.projects.has("alpha")).toBe(true);
  });

  it("neither forgets the project nor removes files when the deletion fails", async () => {
    const forgotten = vi.spyOn(world.cache, "invalidateProject");
    world.failDeletionWith = new Error("disk full");
    await expect(
      deletion("ui").deleteWithEffects(
        actor("uiadmin"),
        "alpha",
        world.effects,
      ),
    ).rejects.toThrow("disk full");
    expect(forgotten).not.toHaveBeenCalled();
    expect(world.effects.removeFiles).not.toHaveBeenCalled();
    expect(world.projects.has("alpha")).toBe(true);
  });

  it("works where the process has nothing to stop or clear", async () => {
    await expect(
      deletion("ui").deleteWithEffects(actor("uiadmin"), "alpha", null),
    ).resolves.toMatchObject({ scope: { project: { id: "alpha" } } });
  });

  it("reports a file problem and still succeeds", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    world.effects.removeFiles.mockRejectedValueOnce(new Error("busy"));
    await expect(
      deletion("ui").deleteWithEffects(
        actor("uiadmin"),
        "alpha",
        world.effects,
      ),
    ).resolves.toMatchObject({ scope: { project: { id: "alpha" } } });
    expect(warning).toHaveBeenCalledOnce();
  });
});

describe("the interface deletes through the same service", () => {
  it("routes ProjectService.deletePermanently to it, with the attached effects", async () => {
    const projects = new ProjectService(repository(), new PermissionService());
    projects.setDeletionEffects(world.effects);
    await projects.deletePermanently(actor("uiadmin"), "alpha");
    expect(world.steps).toEqual(["stop:alpha", "delete:alpha", "files"]);
    expect(world.projects.has("beta")).toBe(true);
  });

  it("applies the same refusals to every interface caller", async () => {
    const management = new ProjectManagementService(
      repository(),
      world.cache,
      "ui",
    );
    await expect(
      management.deletePermanently(actor("manager"), "alpha"),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    await expect(
      management.deletePermanently(actor("admin"), "alpha"),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    expect(world.projects.has("alpha")).toBe(true);
    await management.deletePermanently(actor("uiadmin"), "alpha");
    expect(world.projects.has("alpha")).toBe(false);
  });
});
