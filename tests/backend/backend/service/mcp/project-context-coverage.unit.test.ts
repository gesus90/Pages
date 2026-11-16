import { expect, it, vi } from "vitest";

import { ProjectNotFoundError } from "@/backend/error/ProjectErrors";
import { McpProjectContext } from "@/backend/service/mcp/project/McpProjectContext";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { McpProjectDependencies } from "@/backend/service/mcp/project/McpProjectContext";
import type { User } from "@/definition/User";

const ACTOR = partial<User>({ id: "actor" });

it("reads active project contents and falls back to the archive only for a missing project", async () => {
  const getById = vi
    .fn()
    .mockResolvedValueOnce({ id: "project" })
    .mockRejectedValueOnce(new ProjectNotFoundError())
    .mockRejectedValueOnce(new Error("offline"));
  const readArchived = vi.fn(async () => ({ project: { id: "archived" } }));
  const context = new McpProjectContext(
    ACTOR,
    partial<McpProjectDependencies>({
      projects: {
        getById,
        readArchived,
        findMembers: async () => [],
        findGoals: async () => [],
        findTags: async () => [],
        findEvents: async () => [],
        findIntegration: async () => null,
      },
    }),
  );
  await expect(context.state("project")).resolves.toMatchObject({
    project: { id: "project" },
    isArchived: false,
  });
  await expect(context.state("archived")).resolves.toMatchObject({
    project: { id: "archived" },
    isArchived: true,
  });
  await expect(context.state("project")).rejects.toThrow("offline");
  expect(readArchived).toHaveBeenCalledOnce();
});

it("resolves only visible members and eligible candidates by username", async () => {
  const findEligibleAssignees = vi.fn(async () => [
    { id: "candidate", username: "New" },
  ]);
  const context = new McpProjectContext(
    ACTOR,
    partial<McpProjectDependencies>({
      projects: {
        findMembers: async () => [{ userId: "member", username: "Existing" }],
      },
      tasks: { findEligibleAssignees },
      users: { getById: async () => null },
    }),
  );
  await expect(context.findMember("project", " existing ")).resolves.toBe(
    "member",
  );
  await expect(context.requireCandidate("project", "EXISTING")).resolves.toBe(
    "member",
  );
  expect(findEligibleAssignees).not.toHaveBeenCalled();
  await expect(context.requireCandidate("project", "new")).resolves.toBe(
    "candidate",
  );
  await expect(
    context.requireCandidate("project", "hidden"),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(context.person(null)).resolves.toBeNull();
  await expect(context.person("missing")).resolves.toBeNull();
});

it("publishes a project access change", () => {
  const publish = vi.fn();
  const context = new McpProjectContext(
    ACTOR,
    partial<McpProjectDependencies>({ events: { publish } }),
  );
  context.announceAccessChange("project");
  expect(publish).toHaveBeenCalledWith({
    type: "project.access.changed",
    id: "project",
  });
});
