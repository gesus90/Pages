import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";
import { script } from "../../../definition/plan-fixtures";

const store = vi.hoisted(() => ({ find: vi.fn(), insert: vi.fn() }));
vi.mock(
  "@/backend/database/repositories/agents/AgentOperationKeyRepository",
  () => ({
    AgentOperationKeyRepository: class {
      public find = store.find;
      public insert = store.insert;
    },
  }),
);

import { AgentError } from "@/backend/error/AgentErrors";
import { fingerprintOperation } from "@/backend/service/agents/AgentOperationRecorder";
import { readPlanTemplateCommand } from "@/backend/service/agents/AgentPlanCommandInput";
import { AgentPlanTemplateCommands } from "@/backend/service/agents/AgentPlanTemplateCommands";

const update = vi.fn();
const list = vi.fn();
const view = vi.fn();
const transaction = {};
const service = new AgentPlanTemplateCommands(
  partial<ConstructorParameters<typeof AgentPlanTemplateCommands>[0]>({
    database: {
      transaction: async (work: (value: object) => Promise<unknown>) =>
        work(transaction),
    },
    plans: { view },
    templates: { update, list },
  }),
);
const input = {
  operationId: "op",
  workspaceId: "workspace",
  templateId: "template",
  name: "New",
};

beforeEach(() => {
  vi.resetAllMocks();
  store.find.mockResolvedValue(null);
  update.mockResolvedValue({ id: "template", name: "New" });
  list.mockResolvedValue([{ id: "template", name: "New" }]);
  view.mockResolvedValue({
    id: "plan",
    workspaceId: "workspace",
    nodes: [script("node")],
  });
});

it("updates a template through the checked template service", async () => {
  expect(
    await service.write("user", "plans.templates.update", input),
  ).toMatchObject({
    action: "plans.templates.update",
    templateId: "template",
    template: { name: "New" },
  });
  expect(update).toHaveBeenCalledWith(
    "user",
    { workspaceId: "workspace", templateId: "template" },
    { name: "New", source: null },
    expect.any(Function),
  );
});

it("replays an identical request after a fresh visibility read", async () => {
  const parsed = readPlanTemplateCommand("plans.templates.update", input);
  store.find.mockResolvedValue({
    operation: parsed.operation,
    fingerprint: fingerprintOperation(parsed),
  });
  expect(
    await service.write("user", "plans.templates.update", input),
  ).toMatchObject({ template: { id: "template" } });
  expect(update).not.toHaveBeenCalled();
  expect(list).toHaveBeenCalledWith("user", "workspace");
});

it("rejects reused operation IDs and translates name conflicts", async () => {
  store.find.mockResolvedValueOnce({
    operation: "plans.templates.update",
    fingerprint: "different",
  });
  await expect(
    service.write("user", "plans.templates.update", input),
  ).rejects.toThrow();
  update.mockRejectedValueOnce(new AgentError("template_name_taken"));
  await expect(
    service.write("user", "plans.templates.update", input),
  ).rejects.toThrow();
});

it("uses a saved plan node when replacing a template", async () => {
  await service.write("user", "plans.templates.update", {
    ...input,
    planId: "plan",
    nodeId: "node",
  });
  expect(update).toHaveBeenCalledWith(
    "user",
    expect.any(Object),
    expect.objectContaining({
      source: {
        context: { planId: "plan", workspaceId: "workspace" },
        node: script("node"),
      },
    }),
    expect.any(Function),
  );
  await expect(
    service.write("user", "plans.templates.update", {
      ...input,
      planId: "plan",
      nodeId: "missing",
    }),
  ).rejects.toThrow();
});
