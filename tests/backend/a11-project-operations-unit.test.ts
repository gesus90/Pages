import { expect, it, vi } from "vitest";

import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { readAgentDirectory } from "@/backend/service/agents/AgentDirectoryService";
import { applyAgentProject } from "@/backend/service/agents/AgentProjectOperations";
import { createAgentTaskContext } from "@/backend/service/agents/AgentTaskAccess";
import { ProjectCreationService } from "@/backend/service/project/ProjectCreationService";
import { ProjectManagementService } from "@/backend/service/project/ProjectManagementService";

import { createDatabase, createUser } from "../helpers/factories";

import type { AgentExtensionWriteOperation } from "@/definition/AgentExtensions";
import type { Project } from "@/definition/Project";

vi.mock("@/backend/service/agents/AgentDirectoryService", () => ({
  readAgentDirectory: vi.fn(),
}));

const project: Project = {
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  id: "project-1",
  name: "Project",
  description: "Description",
  departments: [],
  parentId: null,
  status: "active",
  progress: 10,
  placeholderColor: "#FCE3D3",
  hasIcon: false,
  managerId: null,
  managerName: null,
  startDate: null,
  targetDate: null,
  notes: "Notes",
};

function setup() {
  const context = createAgentTaskContext(createDatabase(), createUser());
  const methods = {
    find: vi.spyOn(context.projects, "getById").mockResolvedValue(project),
    update: vi
      .spyOn(ProjectManagementService.prototype, "updateDetails")
      .mockResolvedValue(project),
    create: vi
      .spyOn(ProjectCreationService.prototype, "create")
      .mockResolvedValue(true),
    activity: vi
      .spyOn(ProjectRepository.prototype, "insertActivity")
      .mockResolvedValue(undefined),
    members: vi
      .spyOn(context.projects, "addMember")
      .mockResolvedValue(undefined),
    remove: vi
      .spyOn(context.projects, "removeMember")
      .mockResolvedValue(undefined),
    eligible: vi
      .spyOn(context.tasks, "findEligibleAssignees")
      .mockResolvedValue([createUser({ id: "person" })]),
  };
  vi.mocked(readAgentDirectory).mockResolvedValue({
    people: [
      { id: "person", displayName: "Person", groups: [], departments: [] },
    ],
    groups: [{ id: "group", name: "Group", memberIds: ["person"] }],
    departments: [{ id: "department", name: "Department" }],
  });
  return { context, methods };
}

it.each([
  ["projects.setName", { name: "  Renamed  " }, { name: "Renamed" }],
  [
    "projects.setDescription",
    { description: "New body" },
    { description: "New body" },
  ],
  ["projects.setStatus", { status: "paused" }, { status: "paused" }],
  [
    "projects.setDates",
    { startDate: "2026-01-01", targetDate: "2026-12-31" },
    { startDate: "2026-01-01", targetDate: "2026-12-31" },
  ],
] as const)(
  "updates only the selected fields through the UI service for %s",
  async (operation, parameters, changes) => {
    const run = setup();
    await expect(
      applyAgentProject(run.context, operation, {
        projectId: project.id,
        ...parameters,
      }),
    ).resolves.toEqual({
      id: project.id,
      projectId: project.id,
      changed: true,
    });
    expect(run.methods.update).toHaveBeenCalledExactlyOnceWith(
      run.context.actor,
      project.id,
      {
        name: project.name,
        description: project.description,
        status: project.status,
        progress: project.progress,
        managerId: project.managerId,
        startDate: project.startDate,
        targetDate: project.targetDate,
        notes: project.notes,
        ...changes,
      },
    );
  },
);

it("reports an unchanged project after normalizing its requested name", async () => {
  const run = setup();
  await expect(
    applyAgentProject(run.context, "projects.setName", {
      projectId: project.id,
      name: " Project ",
    }),
  ).resolves.toMatchObject({ changed: false });
});

it("creates a project owned by the actor and marks its activity through the MCP repository", async () => {
  const run = setup();
  const result = await applyAgentProject(run.context, "projects.create", {
    name: "  New  ",
    description: "Body",
    status: "planned",
    departmentIds: ["department"],
  });
  expect(result).toEqual({
    id: expect.any(String),
    projectId: result.id,
    changed: true,
  });
  expect(run.methods.create).toHaveBeenCalledExactlyOnceWith(
    run.context.actor,
    expect.objectContaining({
      id: result.id,
      name: "New",
      ownerId: run.context.actor.id,
      departmentIds: ["department"],
    }),
  );
  expect(run.methods.activity).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      projectId: result.id,
      userId: run.context.actor.id,
      action: "project_created",
    }),
  );
});

const invalidChanges: readonly {
  operation: AgentExtensionWriteOperation;
  parameters: Record<string, unknown>;
}[] = [
  { operation: "projects.setName", parameters: { name: " " } },
  { operation: "projects.setName", parameters: { name: 123 } },
  { operation: "projects.setName", parameters: { name: "a".repeat(201) } },
  {
    operation: "projects.setDescription",
    parameters: { description: "a".repeat(10_001) },
  },
  { operation: "projects.setStatus", parameters: { status: "unknown" } },
  {
    operation: "projects.setDates",
    parameters: { startDate: "2026-12-31", targetDate: "2026-01-01" },
  },
  {
    operation: "projects.setDates",
    parameters: { startDate: 123, targetDate: null },
  },
  { operation: "ticket.delete", parameters: {} },
];

it.each(invalidChanges)(
  "refuses invalid project mutations $operation before updating",
  async ({ operation, parameters }) => {
    const run = setup();
    await expect(
      applyAgentProject(run.context, operation, {
        projectId: project.id,
        ...parameters,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(run.methods.update).not.toHaveBeenCalled();
    expect(run.methods.activity).not.toHaveBeenCalled();
  },
);

it.each([null, "department", Array.from({ length: 101 }, () => "department")])(
  "refuses an invalid department identifier list %j before creating a project",
  async (departmentIds) => {
    const run = setup();
    await expect(
      applyAgentProject(run.context, "projects.create", {
        name: "Project",
        description: "",
        status: "active",
        departmentIds,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(run.methods.create).not.toHaveBeenCalled();
    expect(run.methods.activity).not.toHaveBeenCalled();
  },
);

it.each(["person", "group"])(
  "assigns and removes visible %s members through the existing access service",
  async (targetType) => {
    const run = setup();
    const parameters = {
      projectId: project.id,
      targetType,
      targetId: targetType,
      role: "member",
    };
    await expect(
      applyAgentProject(run.context, "projects.member.assign", parameters),
    ).resolves.toMatchObject({ changed: true, affectedCount: 1 });
    expect(run.methods.members).toHaveBeenCalledExactlyOnceWith(
      run.context.actor,
      project.id,
      "person",
      "member",
    );
    await applyAgentProject(run.context, "projects.member.remove", parameters);
    expect(run.methods.remove).toHaveBeenCalledExactlyOnceWith(
      run.context.actor,
      project.id,
      "person",
    );
  },
);

it("does not assign a visible person who is ineligible for this project", async () => {
  const run = setup();
  run.methods.eligible.mockResolvedValue([]);
  await expect(
    applyAgentProject(run.context, "projects.member.assign", {
      projectId: project.id,
      targetType: "person",
      targetId: "person",
      role: "member",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(run.methods.members).not.toHaveBeenCalled();
});

it.each([
  [{ targetType: "person", targetId: "hidden", role: "member" }, "NOT_FOUND"],
  [{ targetType: "group", targetId: "hidden", role: "member" }, "NOT_FOUND"],
  [
    { targetType: "department", targetId: "hidden", role: "member" },
    "NOT_FOUND",
  ],
  [
    { targetType: "unknown", targetId: "person", role: "member" },
    "INVALID_REQUEST",
  ],
  [
    { targetType: "person", targetId: "person", role: "unknown" },
    "INVALID_REQUEST",
  ],
] as const)(
  "refuses invalid or invisible project membership %j",
  async (parameters, code) => {
    const run = setup();
    await expect(
      applyAgentProject(run.context, "projects.member.assign", {
        projectId: project.id,
        ...parameters,
      }),
    ).rejects.toMatchObject({ code });
    expect(run.methods.members).not.toHaveBeenCalled();
  },
);
