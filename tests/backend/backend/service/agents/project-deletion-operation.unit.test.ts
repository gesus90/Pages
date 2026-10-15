import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { ProjectRunsActiveError } from "@/backend/error/ProjectErrors";
import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { PROJECT_DELETION_COUNT_KEYS } from "@/definition/AgentProjectDeletion";

import { ProjectDeletionWorld } from "../project/project-deletion-world";

let world = new ProjectDeletionWorld();
beforeEach(() => {
  world = new ProjectDeletionWorld();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("deleting a project with either confirmation word", () => {
  it.each(["LÖSCHEN", "DELETE"])(
    "lets a personal administrator delete a chosen project with %s",
    async (confirmation) => {
      const result = await world.delete(
        "admin",
        world.request({ confirmation }),
      );
      expect(result).toMatchObject({
        id: "alpha",
        targetType: "project",
        changed: true,
        affectedUserIds: ["writer"],
      });
      expect(result.deleted?.counts).toMatchObject({
        tickets: 4,
        wikiPages: 2,
      });
      expect(world.projects.has("alpha")).toBe(false);
      expect(world.data.has("alpha")).toBe(false);
    },
  );

  it.each([
    ["de", "DELETE"],
    ["de", "LÖSCHEN"],
    ["en", "DELETE"],
    ["en", "LÖSCHEN"],
  ] as const)(
    "does not tie the word to the interface language (%s account, %s)",
    async (language, confirmation) => {
      const settings = vi
        .spyOn(UserSettingsRepository.prototype, "findByUserId")
        .mockResolvedValue({
          language,
          theme: null,
          timezone: null,
          dateFormat: null,
          weekStart: null,
          notifyEmail: null,
          notifyDesktop: null,
          notifyMentions: null,
          notifyAssignments: null,
          notifyDueDates: null,
          notifyWeeklySummary: null,
        });
      await expect(
        world.delete("admin", world.request({ confirmation })),
      ).resolves.toMatchObject({ changed: true });
      expect(settings).not.toHaveBeenCalled();
    },
  );

  it("deletes an archived project like an active one", async () => {
    world.archive("alpha");
    const result = await world.delete("admin");
    expect(result.deleted?.project.isArchived).toBe(true);
    expect(world.projects.has("alpha")).toBe(false);
  });

  it("deletes, never archives or trashes", async () => {
    await world.delete("admin");
    expect(world.projects.has("alpha")).toBe(false);
    expect(world.archived.has("alpha")).toBe(false);
  });

  it("keeps other projects and every shared object", async () => {
    const shared = { ...world.shared };
    const other = world.data.get("beta");
    await world.delete("admin");
    expect(world.projects.has("beta")).toBe(true);
    expect(world.data.get("beta")).toEqual(other);
    expect(world.shared).toEqual(shared);
  });

  it("works for the administrator of the interface mode as well", async () => {
    await expect(world.delete("uiadmin")).resolves.toMatchObject({
      changed: true,
    });
  });

  it("stops the plan runs first and removes the files after the commit", async () => {
    await world.delete("admin");
    expect(world.steps).toEqual(["stop:alpha", "delete:alpha", "files"]);
    expect(world.effects.removeFiles).toHaveBeenCalledWith({
      agentRunRecords: [{ agentId: "agent-1", runId: "alpha-run" }],
      ticketAttachments: ["alpha-ticket-file"],
      wikiAttachments: ["alpha-wiki-file"],
    });
  });

  it("is audited as an MCP administration change and stored for replay", async () => {
    await world.delete("admin");
    expect(world.audit).toHaveLength(1);
    expect(world.audit[0]).toMatchObject({
      actorId: "admin",
      operation: "admin.projects.delete",
      source: "mcp",
      result: { id: "alpha", targetType: "project", changed: true },
    });
    expect(world.audit[0]?.result.deleted?.project.name).toBe("alpha");
    expect(world.keys.get("admin:delete-once")?.operation).toBe(
      "admin.projects.delete",
    );
  });
});

describe("without a valid confirmation nothing changes", () => {
  it.each([
    ["no confirmation at all", undefined],
    ["an empty word", ""],
    ["lower case", "delete"],
    ["lower case German", "löschen"],
    ["a trailing space", "DELETE "],
    ["a leading space", " LÖSCHEN"],
    ["another word", "yes"],
    ["a number", 1],
    ["null", null],
    ["true", true],
    ["a list holding the word", ["DELETE"]],
  ])("rejects %s", async (label, confirmation) => {
    const before = world.changes();
    const parameters =
      confirmation === undefined
        ? { operationId: "delete-once", projectId: "alpha" }
        : world.request({ confirmation });
    await expect(world.delete("admin", parameters)).rejects.toMatchObject({
      code: "CONFIRMATION_REQUIRED",
      status: 400,
    });
    expect(world.changes()).toEqual(before);
    expect(world.effects.stopRuns).not.toHaveBeenCalled();
    expect(world.effects.removeFiles).not.toHaveBeenCalled();
  });
});

describe("only an administrator may delete, also on direct calls", () => {
  it.each([
    ["a project manager who manages all projects", "manager"],
    ["a writer", "writer"],
  ])("refuses %s even with a valid word", async (label, userId) => {
    const before = world.changes();
    await expect(world.delete(userId)).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
    expect(world.changes()).toEqual(before);
    expect(world.effects.stopRuns).not.toHaveBeenCalled();
  });

  it("answers a refused account the same for a missing project, so nothing leaks", async () => {
    await expect(
      world.delete("manager", world.request({ projectId: "nowhere" })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses an inactive administrator", async () => {
    world.addPerson("sleeper", {
      isAdmin: true,
      isActive: false,
      capabilities: [],
    });
    await expect(world.delete("sleeper")).rejects.toMatchObject({
      code: "invalid_token",
    });
    expect(world.projects.has("alpha")).toBe(true);
  });

  it("refuses an administrator who has to change the password first", async () => {
    world.addPerson("fresh", {
      isAdmin: true,
      mustChangePassword: true,
      capabilities: [],
    });
    await expect(world.delete("fresh")).rejects.toMatchObject({
      code: "invalid_token",
    });
    expect(world.projects.has("alpha")).toBe(true);
  });

  it("refuses an unknown account", async () => {
    await expect(world.delete("ghost")).rejects.toMatchObject({
      code: "invalid_token",
    });
  });

  it("checks again for every call: a revoked administrator is refused", async () => {
    world.addPerson("admin", { isAdmin: false, capabilities: [] });
    await expect(world.delete("admin")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(world.projects.has("alpha")).toBe(true);
  });
});

describe("invalid requests", () => {
  it.each([
    ["no project", { operationId: "x", confirmation: "DELETE" }],
    ["no operation ID", { projectId: "alpha", confirmation: "DELETE" }],
    [
      "an empty project",
      { operationId: "x", projectId: "", confirmation: "DELETE" },
    ],
    [
      "an unknown field",
      {
        operationId: "x",
        projectId: "alpha",
        confirmation: "DELETE",
        force: true,
      },
    ],
    [
      "an oversized project ID",
      { operationId: "x", projectId: "p".repeat(201), confirmation: "DELETE" },
    ],
    ["a list instead of an object", ["alpha"]],
  ])("rejects %s", async (label, parameters) => {
    const before = world.changes();
    await expect(
      world.delete("admin", parameters as Readonly<Record<string, unknown>>),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(world.changes()).toEqual(before);
  });

  it("reports a project that does not exist and changes nothing", async () => {
    const before = world.changes();
    await expect(
      world.delete("admin", world.request({ projectId: "nowhere" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(world.changes()).toEqual(before);
    expect(world.effects.stopRuns).not.toHaveBeenCalled();
  });
});

describe("repeating a call after a lost response", () => {
  it("returns the stored result and touches nothing, not even other projects", async () => {
    const first = await world.delete("admin");
    const afterFirst = world.changes();
    vi.mocked(world.effects.stopRuns).mockClear();
    await expect(world.delete("admin")).resolves.toEqual(first);
    expect(world.changes()).toEqual(afterFirst);
    expect(world.effects.stopRuns).not.toHaveBeenCalled();
    expect(world.audit).toHaveLength(1);
  });

  it("accepts the other confirmation word on the repeat", async () => {
    const first = await world.delete("admin");
    await expect(
      world.delete("admin", world.request({ confirmation: "DELETE" })),
    ).resolves.toEqual(first);
  });

  it("still requires the administrator and the confirmation", async () => {
    await world.delete("admin");
    await expect(world.delete("writer")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      world.delete("admin", { operationId: "delete-once", projectId: "alpha" }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
  });

  it("refuses a repeat once the administrator was revoked", async () => {
    await world.delete("admin");
    world.addPerson("admin", { isAdmin: false, capabilities: [] });
    await expect(world.delete("admin")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuses to reuse the operation ID for another project", async () => {
    await world.delete("admin");
    const afterFirst = world.changes();
    await expect(
      world.delete("admin", world.request({ projectId: "beta" })),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(world.changes()).toEqual(afterFirst);
    expect(world.projects.has("beta")).toBe(true);
  });

  it("refuses an operation ID that another operation used", async () => {
    world.keys.set("admin:delete-once", {
      operation: "admin.roles.assign",
      fingerprint: "other",
      resultJson: "{}",
    });
    await expect(world.delete("admin")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(world.projects.has("alpha")).toBe(true);
  });

  it("reports a project that is already gone for a fresh operation ID", async () => {
    await world.delete("admin");
    const afterFirst = world.changes();
    await expect(
      world.delete("admin", world.request({ operationId: "second-try" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(world.changes()).toEqual(afterFirst);
  });
});

describe("a failure leaves no partial state", () => {
  it("rolls back the data, the audit entry and the replay record", async () => {
    const before = world.changes();
    world.failDeletionWith = new Error("disk full");
    await expect(world.delete("admin")).rejects.toThrow("disk full");
    expect(world.projects.has("alpha")).toBe(true);
    expect(world.data.get("alpha")?.tickets).toBe(4);
    expect(world.keys.size).toBe(0);
    expect(world.audit).toHaveLength(0);
    expect(world.effects.removeFiles).not.toHaveBeenCalled();
    expect(world.changes()).toEqual({
      ...(before as object),
      steps: ["stop:alpha", "delete:alpha"],
    });
  });

  it("can be repeated with the same operation ID once the cause is gone", async () => {
    world.failDeletionWith = new Error("disk full");
    await expect(world.delete("admin")).rejects.toThrow("disk full");
    world.failDeletionWith = null;
    await expect(world.delete("admin")).resolves.toMatchObject({
      changed: true,
    });
    expect(world.projects.has("alpha")).toBe(false);
    expect(world.audit).toHaveLength(1);
    expect(world.projects.has("beta")).toBe(true);
  });

  it("deletes nothing while plan runs refuse to close, and says to retry", async () => {
    world.effects.stopRuns.mockRejectedValueOnce(new ProjectRunsActiveError());
    const before = world.changes();
    await expect(world.delete("admin")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(world.changes()).toEqual(before);
    await expect(world.delete("admin")).resolves.toMatchObject({
      changed: true,
    });
  });

  it("does not turn a file problem after the commit into a failure", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    world.effects.removeFiles.mockRejectedValueOnce(new Error("busy"));
    await expect(world.delete("admin")).resolves.toMatchObject({
      changed: true,
    });
    expect(world.projects.has("alpha")).toBe(false);
    expect(warning).toHaveBeenCalled();
  });
});

describe("reading the extent before deleting", () => {
  it("names the concrete project and counts what would go, changing nothing", async () => {
    const before = world.changes();
    const scope = await world.scope("admin");
    expect(scope.project).toEqual({
      id: "alpha",
      name: "alpha",
      status: "active",
      isArchived: false,
      departmentNames: ["engineering"],
    });
    expect(Object.keys(scope.counts)).toEqual([...PROJECT_DELETION_COUNT_KEYS]);
    expect(scope.counts).toMatchObject({
      tickets: 4,
      wikiPages: 2,
      members: 1,
    });
    expect(scope.detached).toEqual({
      templateAssignments: 1,
      wikiAnchors: 0,
      wikiLinks: 2,
      boardPreferences: 0,
    });
    expect(world.changes()).toEqual(before);
  });

  it("is offered to administrators only", async () => {
    await expect(world.scope("manager")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("reports an unknown project and rejects unknown or missing parameters", async () => {
    await expect(
      world.scope("admin", { projectId: "nowhere" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(world.scope("admin", {})).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    await expect(
      world.scope("admin", { projectId: "alpha", limit: 5 }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});

describe("dispatch", () => {
  it("handles only its own two operations", async () => {
    await expect(
      world.service.handle(
        { userId: "admin", isAdmin: true, permissions: [] },
        "admin.users.list",
        {},
      ),
    ).resolves.toBeNull();
  });

  it("is reached through the MCP router, and the chat router has no such operation", async () => {
    const database = { ...world.connection, ...world.database() };
    const dependencies = {
      projects: new ProjectRepository(database),
      wiki: new WikiRepository(database),
      users: { getById: vi.fn() },
    };
    const identity = { userId: "admin", isAdmin: true, permissions: [] };
    const mcp = new AgentOperationRouter({
      ...dependencies,
      projectDeletion: world.service,
    });
    await expect(
      mcp.handle(identity, {
        operation: "admin.projects.delete",
        parameters: world.request(),
      }),
    ).resolves.toMatchObject({ apiVersion: "1", result: { changed: true } });
    const chat = new AgentOperationRouter({ ...dependencies, channel: "chat" });
    await expect(
      chat.handle(identity, {
        operation: "admin.projects.delete",
        parameters: world.request({ operationId: "chat" }),
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(world.projects.has("beta")).toBe(true);
  });
});
