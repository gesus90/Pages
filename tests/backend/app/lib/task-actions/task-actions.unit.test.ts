import { beforeEach, expect, it, vi } from "vitest";

import { handleTaskAction } from "@/app/lib/task-actions/task-actions.server";

import { ACTOR, outcomeOf } from "../../actions/action-fixtures";
import { taskContext } from "./task-action-fixtures";

const taskService = { restore: vi.fn() };
const gitHubSyncService = { syncSingleTask: vi.fn() };

beforeEach(() => {
  vi.resetAllMocks();
});

it.each([
  ["restore-task", taskService.restore],
  ["sync-github-task", gitHubSyncService.syncSingleTask],
])("runs the handler of the intent %s", async (intent, method) => {
  const context = taskContext(
    { gitHubSyncService, taskService },
    { id: "ticket-1" },
  );

  const outcome = await outcomeOf(await handleTaskAction(intent, context));

  expect(method).toHaveBeenCalledExactlyOnceWith(ACTOR, "ticket-1");
  expect(outcome.body).toEqual({ ok: true, intent });
});

it.each([null, "", "unknown", "constructor", "__proto__"])(
  "answers the intent %j like an invalid new ticket",
  async (intent) => {
    const context = taskContext({ taskService }, { id: "ticket-1" });

    const outcome = await outcomeOf(await handleTaskAction(intent, context));

    expect(outcome).toMatchObject({
      status: 400,
      body: { ok: false, intent: "create-task", error: "invalidInput" },
    });
    expect(taskService.restore).not.toHaveBeenCalled();
  },
);

it("answers a file as intent like an invalid new ticket", async () => {
  const intent = new File(["restore-task"], "restore-task");

  const outcome = await outcomeOf(
    await handleTaskAction(intent, taskContext({ taskService }, {})),
  );

  expect(outcome.status).toBe(400);
});
