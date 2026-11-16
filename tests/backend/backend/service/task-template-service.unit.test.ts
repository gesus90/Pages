import { beforeEach, expect, it, vi } from "vitest";

import { TaskTemplateService } from "@/backend/service/TaskTemplateService";
import { TEMPLATE_SCOPE } from "@/definition/WorkItemTemplate";

import { partial } from "../../app/lib/service-wiring-fakes";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type { WorkItemTemplateRepository } from "@/backend/database/repositories/task/WorkItemTemplateRepository";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { TaskService } from "@/backend/service/TaskService";
import type { User } from "@/definition/User";

const save = vi.fn();
const findById = vi.fn();
const findAll = vi.fn();
const getById = vi.fn();
const create = vi.fn();
const assignLabel = vi.fn();
const addChecklistItem = vi.fn();
const hasCapability = vi.fn();
const actor = partial<User>({ id: "user" });
const account = {
  userId: "user",
  isActive: true,
  departments: ["department"],
  managedDepartments: [],
  allDepartments: false,
  role: null,
};
const template = {
  id: "template",
  ownerId: "user",
  name: "Template",
  scope: TEMPLATE_SCOPE.PRIVATE,
  departmentIds: [],
  projectIds: [],
  labelIds: ["label"],
  checklist: ["Check"],
  title: "Task",
  description: "Description",
  priority: "normal",
  type: "task",
};
const repository = partial<WorkItemTemplateRepository>({
  save,
  findById,
  findAll,
});
const tasks = partial<TaskService>({
  getById,
  create,
  assignLabel,
  addChecklistItem,
  findLabelsForWorkItems: async () => new Map([["ticket", [{ id: "label" }]]]),
  findChecklistItems: async () => [{ title: "Check" }],
});
const projects = partial<ProjectService>({
  authorizationFacts: async () => ({
    account,
    departments: [{ id: "department" }],
  }),
  findAll: async () => [{ id: "project" }],
});
const permissions = partial<PermissionService>({ hasCapability });
const service = new TaskTemplateService(
  repository,
  tasks,
  projects,
  permissions,
);

beforeEach(() => {
  vi.resetAllMocks();
  findAll.mockResolvedValue([
    template,
    { ...template, id: "hidden", ownerId: "other" },
  ]);
  findById.mockResolvedValue(template);
  getById.mockResolvedValue({
    id: "ticket",
    title: "Task",
    description: "Description",
    priority: "normal",
    type: "task",
  });
  create.mockResolvedValue({ id: "new" });
  hasCapability.mockResolvedValue(true);
});

it("lists only visible templates and marks the owner's management rights", async () => {
  expect(await service.findVisible(actor)).toMatchObject([
    { id: "template", canManage: true },
  ]);
});

it("saves a ticket's content and normalizes a private share", async () => {
  await service.saveFromTicket(actor, "ticket", {
    name: " Template ",
    scope: TEMPLATE_SCOPE.PRIVATE,
    departmentIds: ["ignored"],
    projectIds: [],
  });
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "Template",
      ownerId: "user",
      departmentIds: [],
      labelIds: ["label"],
      checklist: ["Check"],
    }),
  );
});

it("refuses missing write rights and invalid share targets", async () => {
  hasCapability.mockResolvedValueOnce(false);
  await expect(
    service.saveFromTicket(actor, "ticket", {
      name: "T",
      scope: TEMPLATE_SCOPE.PRIVATE,
      departmentIds: [],
      projectIds: [],
    }),
  ).rejects.toThrow();
  await expect(
    service.saveFromTicket(actor, "ticket", {
      name: "T",
      scope: TEMPLATE_SCOPE.PROJECTS,
      departmentIds: [],
      projectIds: ["hidden"],
    }),
  ).rejects.toThrow();
  await expect(
    service.saveFromTicket(actor, "ticket", {
      name: " ",
      scope: TEMPLATE_SCOPE.PRIVATE,
      departmentIds: [],
      projectIds: [],
    }),
  ).rejects.toThrow();
  expect(save).not.toHaveBeenCalled();
});

it("copies labels and checklist entries into a newly created ticket", async () => {
  const input = partial<
    Parameters<TaskTemplateService["createFromTemplate"]>[2]
  >({ projectId: "project", title: "New" });
  expect(await service.createFromTemplate(actor, "template", input)).toEqual({
    id: "new",
  });
  expect(assignLabel).toHaveBeenCalledWith(actor, "new", "label");
  expect(addChecklistItem).toHaveBeenCalledWith(actor, "new", "Check");
});
