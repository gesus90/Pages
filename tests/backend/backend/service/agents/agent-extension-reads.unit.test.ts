import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentTaskContext } from "@/backend/service/agents/AgentTaskAccess";

const directory = vi.hoisted(() => vi.fn());
vi.mock("@/backend/service/agents/AgentDirectoryService", () => ({
  readAgentDirectory: directory,
}));

import { readAgentExtension } from "@/backend/service/agents/AgentExtensionReads";

const labels = vi.fn();
const project = vi.fn();
const members = vi.fn();
const activity = vi.fn();
const context = partial<AgentTaskContext>({
  actor: { id: "user" },
  tasks: { findLabels: labels },
  projects: { getById: project, findMembers: members, findActivity: activity },
});

beforeEach(() => {
  vi.resetAllMocks();
  labels.mockResolvedValue([{ id: "tag", name: "Tag", color: "red" }]);
  directory.mockResolvedValue({
    people: [{ id: "visible", displayName: "Visible" }],
    groups: [{ id: "group", name: "Group", memberIds: ["visible"] }],
    departments: [{ id: "department", name: "Department" }],
  });
  project.mockResolvedValue({
    departments: [
      { id: "department", name: "Department" },
      { id: "hidden", name: "Hidden" },
    ],
  });
  members.mockResolvedValue([
    { userId: "visible", projectRole: "member" },
    { userId: "hidden", projectRole: "member" },
  ]);
  activity.mockResolvedValue([
    {
      id: "event",
      userId: "visible",
      projectId: "project",
      category: "ticket",
      action: "created",
      message: "Created",
      createdAt: "2026-01-01",
      source: "ui",
    },
  ]);
});

it("pages tags and visible directory entries without revealing group memberships", async () => {
  expect(await readAgentExtension(context, "tags.list", {})).toMatchObject({
    tags: [{ id: "tag", name: "Tag" }],
    total: 1,
  });
  expect(
    await readAgentExtension(context, "people.visible.list", {}),
  ).toMatchObject({ people: [{ id: "visible" }], total: 1 });
  expect(await readAgentExtension(context, "groups.list", {})).toMatchObject({
    entries: [{ id: "group", name: "Group" }],
    total: 1,
  });
  expect(
    await readAgentExtension(context, "departments.list", {}),
  ).toMatchObject({ entries: [{ id: "department" }], total: 1 });
});

it("filters project members and departments through the visible directory", async () => {
  expect(
    await readAgentExtension(context, "projects.members.read", {
      projectId: "project",
    }),
  ).toMatchObject({
    projectId: "project",
    members: [{ id: "visible", role: "member" }],
    departments: [{ id: "department" }],
    total: 1,
  });
});

it("attaches visible actors to activity without exposing hidden accounts", async () => {
  expect(
    await readAgentExtension(context, "projects.activity.read", {
      projectId: "project",
    }),
  ).toMatchObject({
    entries: [{ id: "event", actor: { id: "visible" } }],
    total: 1,
  });
  activity.mockResolvedValue([
    {
      id: "event",
      userId: "hidden",
      projectId: "project",
      createdAt: "2026-01-01",
    },
  ]);
  const result = await readAgentExtension(context, "projects.activity.read", {
    projectId: "project",
  });
  expect(result).toMatchObject({ entries: [{ id: "event" }] });
  expect(JSON.stringify(result)).not.toContain("hidden");
});
