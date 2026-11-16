import { beforeEach, expect, it, vi } from "vitest";

import { McpProjectWriteService } from "@/backend/service/mcp/project/McpProjectWriteService";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpProjectContext } from "@/backend/service/mcp/project/McpProjectContext";

const project = {
  id: "project",
  name: "Before",
  description: "Description",
  status: "planned",
  notes: "Notes",
  progress: 0,
  managerId: null,
  startDate: null,
  targetDate: null,
  departments: [],
  hasIcon: false,
};
const getById = vi.fn();
const updateDetails = vi.fn();
const setTags = vi.fn();
const setDepartments = vi.fn();
const announceAccessChange = vi.fn();
const findMember = vi.fn();
const requireCandidate = vi.fn();
const saveTemplate = vi.fn();
const findTemplates = vi.fn();
const state = vi.fn();
const context = partial<McpProjectContext>({
  actor: { id: "user" },
  services: {
    projects: {
      getById,
      updateDetails,
      setTags,
      setDepartments,
      saveTemplate,
      findTemplates,
    },
  },
  announceAccessChange,
  findMember,
  requireCandidate,
  state,
  person: async () => null,
});
const service = new McpProjectWriteService();

beforeEach(() => {
  vi.resetAllMocks();
  getById.mockResolvedValue(project);
  state.mockResolvedValue({
    project,
    isArchived: false,
    tags: [],
    members: [],
    goals: [],
    events: [],
    integration: null,
  });
  findMember.mockResolvedValue("manager-id");
});

it("patches named fields and changes departments last", async () => {
  const result = await service.patch(context, "project", {
    name: "After",
    manager: "alice",
    tags: ["tag"],
    departmentIds: ["department"],
  });
  expect(result).toMatchObject({ id: "project", name: "Before" });
  expect(updateDetails).toHaveBeenCalledWith(
    context.actor,
    "project",
    expect.objectContaining({
      name: "After",
      description: "Description",
      managerId: "manager-id",
    }),
  );
  expect(setTags).toHaveBeenCalledOnce();
  expect(setDepartments).toHaveBeenCalledOnce();
  expect(announceAccessChange).toHaveBeenCalledWith("project");
  expect(setTags.mock.invocationCallOrder[0]).toBeLessThan(
    setDepartments.mock.invocationCallOrder[0],
  );
});

it("rejects a visible manager outside the project team", async () => {
  findMember.mockResolvedValue(null);
  await expect(
    service.patch(context, "project", { manager: "other" }),
  ).rejects.toThrow();
  expect(requireCandidate).toHaveBeenCalledWith("project", "other");
  expect(updateDetails).not.toHaveBeenCalled();
});

it("returns the saved template or rejects a missing result", async () => {
  findTemplates
    .mockResolvedValueOnce([
      { id: "template", name: "Template", projectId: "project" },
    ])
    .mockResolvedValueOnce([]);
  expect(await service.saveTemplate(context, "project")).toEqual({
    id: "template",
    name: "Template",
  });
  await expect(service.saveTemplate(context, "project")).rejects.toThrow();
});
