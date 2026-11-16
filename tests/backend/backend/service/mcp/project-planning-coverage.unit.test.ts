import { expect, it, vi } from "vitest";

import { McpProjectPlanningService } from "@/backend/service/mcp/project/McpProjectPlanningService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { McpProjectContext } from "@/backend/service/mcp/project/McpProjectContext";

function fixture(): {
  context: McpProjectContext;
  projects: {
    addMember: ReturnType<typeof vi.fn>;
    updateMemberRole: ReturnType<typeof vi.fn>;
    removeMember: ReturnType<typeof vi.fn>;
    createGoal: ReturnType<typeof vi.fn>;
    updateGoal: ReturnType<typeof vi.fn>;
    deleteGoal: ReturnType<typeof vi.fn>;
    createEvent: ReturnType<typeof vi.fn>;
    archiveEvent: ReturnType<typeof vi.fn>;
  };
  findMember: ReturnType<typeof vi.fn>;
} {
  const projects = {
    addMember: vi.fn(),
    updateMemberRole: vi.fn(),
    removeMember: vi.fn(),
    createGoal: vi.fn(),
    updateGoal: vi.fn(),
    deleteGoal: vi.fn(),
    createEvent: vi.fn(),
    archiveEvent: vi.fn(),
    findGoals: async () => [{ id: "goal", title: "Goal" }],
    findEvents: async () => [{ id: "event" }],
  };
  const findMember = vi.fn<() => Promise<string | null>>(async () => "member");
  const context = partial<McpProjectContext>({
    actor: { id: "actor" },
    services: { projects },
    findMember,
    requireCandidate: async () => "candidate",
    requireVisible: async () => undefined,
    state: async () => ({
      project: { id: "project", name: "Project", departments: [] },
      isArchived: false,
      tags: [],
      members: [],
      goals: [],
      events: [],
      integration: null,
    }),
    person: async () => null,
  });
  return { context, projects, findMember };
}

it("adds new members and updates or removes existing members", async () => {
  const { context, projects, findMember } = fixture();
  const service = new McpProjectPlanningService();
  await service.setMember(context, "project", {
    username: "user",
    role: "member",
  });
  expect(projects.updateMemberRole).toHaveBeenCalledWith(
    context.actor,
    "project",
    "member",
    "member",
  );
  findMember.mockResolvedValueOnce(null);
  await service.setMember(context, "project", {
    username: "new",
    role: "member",
  });
  expect(projects.addMember).toHaveBeenCalledWith(
    context.actor,
    "project",
    "candidate",
    "member",
  );
  await service.removeMember(context, "project", "user");
  expect(projects.removeMember).toHaveBeenCalledWith(
    context.actor,
    "project",
    "member",
  );
  findMember.mockResolvedValueOnce(null);
  await expect(
    service.removeMember(context, "project", "missing"),
  ).rejects.toMatchObject({ code: "not_found" });
});

it("preserves goal titles and checks membership before changes", async () => {
  const { context, projects } = fixture();
  const service = new McpProjectPlanningService();
  await service.createGoal(context, "project", "New");
  await service.setGoalDone(
    context,
    { projectId: "project", goalId: "goal" },
    true,
  );
  expect(projects.updateGoal).toHaveBeenCalledWith(
    context.actor,
    "project",
    "goal",
    { isDone: true, title: "Goal" },
  );
  await service.deleteGoal(context, "project", "goal");
  await expect(
    service.deleteGoal(context, "project", "missing"),
  ).rejects.toMatchObject({ code: "not_found" });
});

it("fills optional event fields and refuses to archive a missing event", async () => {
  const { context, projects } = fixture();
  const service = new McpProjectPlanningService();
  await service.createEvent(context, "project", {
    title: "Meeting",
    date: "2026-01-01",
  });
  expect(projects.createEvent).toHaveBeenCalledWith(context.actor, "project", {
    title: "Meeting",
    eventDate: "2026-01-01",
    eventTime: null,
    type: "general",
    description: "",
  });
  await service.archiveEvent(context, "project", "event");
  await expect(
    service.archiveEvent(context, "project", "missing"),
  ).rejects.toMatchObject({ code: "not_found" });
});
