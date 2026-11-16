import { beforeEach, expect, it, vi } from "vitest";

import { AgentPlanTemplateService } from "@/backend/service/agents/AgentPlanTemplateService";

import { partial } from "../../../app/lib/service-wiring-fakes";
import { script } from "../../../definition/plan-fixtures";

const team = vi.fn();
const list = vi.fn();
const find = vi.fn();
const create = vi.fn();
const update = vi.fn();
const view = vi.fn();
const agents = vi.fn();
const checkNodes = vi.fn();
const service = new AgentPlanTemplateService(
  partial<ConstructorParameters<typeof AgentPlanTemplateService>[0]>({
    templates: { list, find, create, update },
    plans: { team, view, agents, checkNodes },
  }),
);
const context = { planId: "plan", workspaceId: "workspace" };

beforeEach(() => {
  vi.resetAllMocks();
  team.mockResolvedValue({
    projectId: "project",
    departmentId: "department",
    departmentIds: ["department"],
  });
  list.mockResolvedValue([]);
  find.mockResolvedValue({ id: "template", node: script("old") });
  create.mockImplementation(async (value) => value);
  update.mockImplementation(async (value) => value);
  view.mockResolvedValue({ canEdit: true });
  agents.mockResolvedValue([]);
});

it("lists templates in the current project and department scope", async () => {
  expect(await service.list("user", "workspace")).toEqual([]);
  expect(list).toHaveBeenCalledWith({
    ownerId: "user",
    projectId: "project",
    departmentIds: ["department"],
  });
});

it("saves a checked independent node for the current team", async () => {
  const result = await service.save("user", context, {
    name: "Template",
    node: script("source"),
  });
  expect(result).toMatchObject({
    ownerId: "user",
    name: "Template",
    team: { projectId: "project", departmentId: "department" },
  });
  expect(checkNodes).toHaveBeenCalledOnce();
  expect(create.mock.calls[0][0].node.id).not.toBe("source");
});

it("inserts a fresh copy after rechecking access and references", async () => {
  const node = await service.insert("user", context, "template");
  expect(node.id).not.toBe("old");
  expect(checkNodes).toHaveBeenCalledOnce();
  find.mockResolvedValueOnce(null);
  await expect(service.insert("user", context, "missing")).rejects.toThrow();
  view.mockResolvedValueOnce({ canEdit: false });
  await expect(service.insert("user", context, "template")).rejects.toThrow();
});

it("requires visibility before updating a template", async () => {
  await service.update(
    "user",
    { workspaceId: "workspace", templateId: "template" },
    { name: "New", source: null },
  );
  expect(update).toHaveBeenCalledWith(
    { id: "template", ownerId: "user", name: "New", node: null },
    undefined,
  );
  find.mockResolvedValueOnce(null);
  await expect(
    service.update(
      "user",
      { workspaceId: "workspace", templateId: "missing" },
      { name: null, source: null },
    ),
  ).rejects.toThrow();
});
