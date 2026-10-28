import { beforeEach, expect, it, vi } from "vitest";

import {
  handleDeleteTemplate,
  handleSaveTemplate,
} from "@/app/lib/task-actions/task-template-actions.server";

import { ACTOR } from "../../actions/action-fixtures";
import { runTaskHandler } from "./task-action-fixtures";

import type { FormFields } from "../../actions/action-fixtures";

const taskTemplateService = {
  delete: vi.fn(),
  saveFromTicket: vi.fn(),
  update: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
});

async function save(fields: FormFields): ReturnType<typeof runTaskHandler> {
  return runTaskHandler(handleSaveTemplate, { taskTemplateService }, fields);
}

function nothingCalled(): void {
  for (const method of Object.values(taskTemplateService)) {
    expect(method).not.toHaveBeenCalled();
  }
}

it("saves a ticket as a template with the text entries of its scope", async () => {
  const outcome = await save({
    name: "Bug report",
    scope: "departments",
    ticketId: "t1",
    departmentIds: ["d1", "d2"],
    projectIds: "p1",
  });

  expect(taskTemplateService.saveFromTicket).toHaveBeenCalledExactlyOnceWith(
    ACTOR,
    "t1",
    {
      departmentIds: ["d1", "d2"],
      name: "Bug report",
      projectIds: ["p1"],
      scope: "departments",
    },
  );
  expect(outcome.body).toEqual({ ok: true, intent: "save-template" });
});

it("renames and reshares a template and skips file entries", async () => {
  const form = {
    name: "Renamed",
    scope: "private",
    templateId: "tpl-1",
    departmentIds: new File(["d1"], "d1.txt"),
  };

  await save(form);

  expect(taskTemplateService.update).toHaveBeenCalledExactlyOnceWith(
    ACTOR,
    "tpl-1",
    { departmentIds: [], name: "Renamed", projectIds: [], scope: "private" },
  );
  expect(taskTemplateService.saveFromTicket).not.toHaveBeenCalled();
});

it.each([
  ["no name", { scope: "all", ticketId: "t1" }],
  ["an unknown scope", { name: "n", scope: "team", ticketId: "t1" }],
  ["neither ticket nor template", { name: "n", scope: "all" }],
  [
    "both ticket and template",
    { name: "n", scope: "all", ticketId: "t1", templateId: "x" },
  ],
])("refuses a template with %s", async (caseName, fields) => {
  const outcome = await save(fields);

  expect(outcome).toMatchObject({
    status: 400,
    body: { intent: "save-template", error: "invalidInput" },
  });
  nothingCalled();
});

it("deletes a template", async () => {
  const outcome = await runTaskHandler(
    handleDeleteTemplate,
    { taskTemplateService },
    { templateId: "tpl-1" },
  );

  expect(taskTemplateService.delete).toHaveBeenCalledWith(ACTOR, "tpl-1");
  expect(outcome.body).toEqual({ ok: true, intent: "delete-template" });
});

it("refuses to delete a template without id", async () => {
  const outcome = await runTaskHandler(
    handleDeleteTemplate,
    { taskTemplateService },
    {},
  );

  expect(outcome.status).toBe(400);
  nothingCalled();
});
