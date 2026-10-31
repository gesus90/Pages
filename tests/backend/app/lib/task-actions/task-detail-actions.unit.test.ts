import { beforeEach, expect, it, vi } from "vitest";

import {
  handleAddChecklistItem,
  handleAddLink,
  handleAssignLabel,
  handleCreateLabel,
  handleDeleteChecklistItem,
  handleDeleteLabel,
  handleRemoveLink,
  handleToggleChecklistItem,
  handleUnassignLabel,
  handleUpdateLabel,
} from "@/app/lib/task-actions/task-detail-actions.server";

import { ACTOR } from "../../actions/action-fixtures";
import { runTaskHandler } from "./task-action-fixtures";

import type { TaskActionHandler } from "@/app/lib/task-actions/task-action-support.server";
import type { FormFields } from "../../actions/action-fixtures";

const taskService = {
  addChecklistItem: vi.fn(),
  addLink: vi.fn(),
  assignLabel: vi.fn(),
  createLabel: vi.fn(),
  deleteChecklistItem: vi.fn(),
  deleteLabel: vi.fn(),
  removeLink: vi.fn(),
  setChecklistItemDone: vi.fn(),
  unassignLabel: vi.fn(),
  updateLabel: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
});

async function run(
  handler: TaskActionHandler,
  fields: FormFields,
): ReturnType<typeof runTaskHandler> {
  return runTaskHandler(handler, { taskService }, fields);
}

it("passes displayed checklist values to conditional changes", async () => {
  await run(handleToggleChecklistItem, {
    checklistItemId: "c1",
    isDone: "true",
    baseTitle: "Review changes",
    baseIsDone: "false",
  });
  expect(taskService.setChecklistItemDone).toHaveBeenCalledWith(
    ACTOR,
    "c1",
    true,
    {
      title: "Review changes",
      isDone: false,
    },
  );
  await run(handleDeleteChecklistItem, {
    checklistItemId: "c1",
    baseTitle: "Review changes",
    baseIsDone: "true",
  });
  expect(taskService.deleteChecklistItem).toHaveBeenCalledWith(ACTOR, "c1", {
    title: "Review changes",
    isDone: true,
  });
  const invalid = await run(handleToggleChecklistItem, {
    checklistItemId: "c1",
    isDone: "true",
    baseIsDone: "false",
  });
  expect(invalid.status).toBe(400);
});

interface DetailCase {
  readonly handler: TaskActionHandler;
  readonly intent: string;
  readonly fields: FormFields;
  readonly method: keyof typeof taskService;
  readonly call: readonly unknown[];
}

const SUCCESSES: readonly (readonly [string, DetailCase])[] = [
  [
    "creates a label",
    {
      handler: handleCreateLabel,
      intent: "label-create",
      fields: { name: "Bug", color: "red" },
      method: "createLabel",
      call: [ACTOR, { color: "red", name: "Bug" }],
    },
  ],
  [
    "updates a label",
    {
      handler: handleUpdateLabel,
      intent: "label-update",
      fields: { labelId: "l1", name: "Fix", color: "blue" },
      method: "updateLabel",
      call: [ACTOR, "l1", { color: "blue", name: "Fix" }],
    },
  ],
  [
    "deletes a label",
    {
      handler: handleDeleteLabel,
      intent: "label-delete",
      fields: { labelId: "l1" },
      method: "deleteLabel",
      call: [ACTOR, "l1"],
    },
  ],
  [
    "assigns a label",
    {
      handler: handleAssignLabel,
      intent: "label-assign",
      fields: { workItemId: "t1", labelId: "l1" },
      method: "assignLabel",
      call: [ACTOR, "t1", "l1"],
    },
  ],
  [
    "unassigns a label",
    {
      handler: handleUnassignLabel,
      intent: "label-unassign",
      fields: { workItemId: "t1", labelId: "l1" },
      method: "unassignLabel",
      call: [ACTOR, "t1", "l1"],
    },
  ],
  [
    "adds a checklist item",
    {
      handler: handleAddChecklistItem,
      intent: "checklist-add",
      fields: { workItemId: "t1", title: "Write tests" },
      method: "addChecklistItem",
      call: [ACTOR, "t1", "Write tests"],
    },
  ],
  [
    "checks a checklist item",
    {
      handler: handleToggleChecklistItem,
      intent: "checklist-toggle",
      fields: { checklistItemId: "c1", isDone: "true" },
      method: "setChecklistItemDone",
      call: [ACTOR, "c1", true],
    },
  ],
  [
    "unchecks a checklist item for anything but true",
    {
      handler: handleToggleChecklistItem,
      intent: "checklist-toggle",
      fields: { checklistItemId: "c1", isDone: "yes" },
      method: "setChecklistItemDone",
      call: [ACTOR, "c1", false],
    },
  ],
  [
    "deletes a checklist item",
    {
      handler: handleDeleteChecklistItem,
      intent: "checklist-delete",
      fields: { checklistItemId: "c1" },
      method: "deleteChecklistItem",
      call: [ACTOR, "c1"],
    },
  ],
  [
    "links two tickets",
    {
      handler: handleAddLink,
      intent: "link-add",
      fields: { workItemId: "t1", targetKey: "SYN-2", linkType: "blocks" },
      method: "addLink",
      call: [ACTOR, "t1", "SYN-2", "blocks"],
    },
  ],
  [
    "removes a link",
    {
      handler: handleRemoveLink,
      intent: "link-remove",
      fields: { workItemId: "t1", linkId: "k1" },
      method: "removeLink",
      call: [ACTOR, "t1", "k1"],
    },
  ],
];

it.each(SUCCESSES)("%s", async (caseName, detail) => {
  const outcome = await run(detail.handler, detail.fields);

  expect(taskService[detail.method]).toHaveBeenCalledExactlyOnceWith(
    ...detail.call,
  );
  expect(outcome).toMatchObject({
    status: 200,
    body: { ok: true, intent: detail.intent },
  });
});

const REFUSALS: readonly (readonly [string, TaskActionHandler, FormFields])[] =
  [
    ["a label without name", handleCreateLabel, { color: "red" }],
    ["a label without color", handleCreateLabel, { name: "Bug" }],
    ["a label update without id", handleUpdateLabel, { name: "a", color: "b" }],
    [
      "a label update without name",
      handleUpdateLabel,
      { labelId: "l1", color: "b" },
    ],
    [
      "a label update without color",
      handleUpdateLabel,
      { labelId: "l1", name: "a" },
    ],
    ["a label deletion without id", handleDeleteLabel, {}],
    ["an assignment without ticket", handleAssignLabel, { labelId: "l1" }],
    ["an assignment without label", handleAssignLabel, { workItemId: "t1" }],
    ["a removal without ticket", handleUnassignLabel, { labelId: "l1" }],
    ["a removal without label", handleUnassignLabel, { workItemId: "t1" }],
    ["an item without ticket", handleAddChecklistItem, { title: "x" }],
    ["an item without title", handleAddChecklistItem, { workItemId: "t1" }],
    [
      "an item with a blank title",
      handleAddChecklistItem,
      { workItemId: "t1", title: "  " },
    ],
    ["a toggle without item", handleToggleChecklistItem, { isDone: "true" }],
    ["an item deletion without item", handleDeleteChecklistItem, {}],
    [
      "a link without ticket",
      handleAddLink,
      { targetKey: "S-1", linkType: "blocks" },
    ],
    [
      "a link without target",
      handleAddLink,
      { workItemId: "t1", linkType: "blocks" },
    ],
    [
      "a link with a blank target",
      handleAddLink,
      { workItemId: "t1", targetKey: " ", linkType: "blocks" },
    ],
    [
      "a link of an unknown type",
      handleAddLink,
      { workItemId: "t1", targetKey: "S-1", linkType: "owns" },
    ],
    ["a link removal without ticket", handleRemoveLink, { linkId: "k1" }],
    ["a link removal without link", handleRemoveLink, { workItemId: "t1" }],
  ];

it.each(REFUSALS)("refuses %s", async (caseName, handler, fields) => {
  const outcome = await run(handler, fields);

  expect(outcome).toMatchObject({
    status: 400,
    body: { ok: false, error: "invalidInput" },
  });
  for (const method of Object.values(taskService)) {
    expect(method).not.toHaveBeenCalled();
  }
});
