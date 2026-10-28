import { beforeEach, expect, it, vi } from "vitest";

import {
  handleChangeParent,
  handleRemoveAttachment,
  handleSetTreeExpanded,
  handleUpdateDescription,
} from "@/app/lib/task-actions/task-hierarchy-actions.server";

import { ACTOR } from "../../actions/action-fixtures";
import { runTaskHandler } from "./task-action-fixtures";

import type { TaskActionHandler } from "@/app/lib/task-actions/task-action-support.server";
import type { FormFields } from "../../actions/action-fixtures";

const taskService = { changeParent: vi.fn(), updateDescription: vi.fn() };
const taskAttachmentService = { remove: vi.fn() };
const ticketTreeService = { setExpanded: vi.fn() };
const services = { taskService, taskAttachmentService, ticketTreeService };

beforeEach(() => {
  vi.resetAllMocks();
  taskService.changeParent.mockResolvedValue({ key: "SYN-2" });
  taskService.updateDescription.mockResolvedValue({ key: "SYN-1" });
});

async function run(
  handler: TaskActionHandler,
  fields: FormFields,
): ReturnType<typeof runTaskHandler> {
  return runTaskHandler(handler, services, fields);
}

function nothingCalled(): void {
  for (const method of [
    taskService.changeParent,
    taskService.updateDescription,
    taskAttachmentService.remove,
    ticketTreeService.setExpanded,
  ]) {
    expect(method).not.toHaveBeenCalled();
  }
}

it("saves a description written from its base text", async () => {
  const outcome = await run(handleUpdateDescription, {
    id: "t1",
    description: "",
    baseDescription: "Old",
  });

  expect(taskService.updateDescription).toHaveBeenCalledWith(ACTOR, "t1", {
    baseDescription: "Old",
    description: "",
  });
  expect(outcome.body).toEqual({
    ok: true,
    intent: "update-description",
    key: "SYN-1",
  });
});

it.each<FormFields>([
  { description: "a", baseDescription: "b" },
  { id: "t1", baseDescription: "b" },
  { id: "t1", description: "a" },
])("refuses the description %j", async (fields) => {
  expect((await run(handleUpdateDescription, fields)).status).toBe(400);
  nothingCalled();
});

it("moves a ticket below another parent", async () => {
  const outcome = await run(handleChangeParent, { id: "t1", parentId: "e1" });

  expect(taskService.changeParent).toHaveBeenCalledWith(ACTOR, "t1", "e1");
  expect(outcome.body).toEqual({
    ok: true,
    intent: "change-parent",
    key: "SYN-2",
  });
});

it("removes the parent for an empty value", async () => {
  await run(handleChangeParent, { id: "t1", parentId: "" });

  expect(taskService.changeParent).toHaveBeenCalledWith(ACTOR, "t1", null);
});

it.each<FormFields>([{ parentId: "e1" }, { id: "t1" }])(
  "refuses the parent change %j",
  async (fields) => {
    expect((await run(handleChangeParent, fields)).status).toBe(400);
    nothingCalled();
  },
);

it("removes an attachment", async () => {
  const outcome = await run(handleRemoveAttachment, { attachmentId: "a1" });

  expect(taskAttachmentService.remove).toHaveBeenCalledWith(ACTOR, "a1");
  expect(outcome.body).toEqual({ ok: true, intent: "remove-attachment" });
});

it("refuses to remove an attachment without id", async () => {
  expect((await run(handleRemoveAttachment, {})).status).toBe(400);
  nothingCalled();
});

it.each([
  ["1", true],
  ["0", false],
])("stores the branch state %s", async (expanded, isExpanded) => {
  const outcome = await run(handleSetTreeExpanded, {
    nodeKey: "epic:e1",
    expanded,
  });

  expect(ticketTreeService.setExpanded).toHaveBeenCalledWith(
    ACTOR,
    "epic:e1",
    isExpanded,
  );
  expect(outcome.body).toEqual({ ok: true, intent: "set-tree-expanded" });
});

it.each<FormFields>([
  { expanded: "1" },
  { nodeKey: "n" },
  { nodeKey: "n", expanded: "yes" },
])("refuses the branch state %j", async (fields) => {
  expect((await run(handleSetTreeExpanded, fields)).status).toBe(400);
  nothingCalled();
});
