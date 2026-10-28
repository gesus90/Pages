import { beforeEach, expect, it, vi } from "vitest";

import { handleSaveBoardPreferences } from "@/app/lib/task-actions/task-board-actions.server";
import { logCaughtError } from "@/backend/logging/Logger";

import { ACTOR } from "../../actions/action-fixtures";
import { runTaskHandler } from "./task-action-fixtures";

import type { FormFields } from "../../actions/action-fixtures";

vi.mock(import("@/backend/logging/Logger"), async (importOriginal) => ({
  ...(await importOriginal()),
  logCaughtError: vi.fn(),
}));

const boardPreferencesService = { save: vi.fn() };

beforeEach(() => {
  vi.resetAllMocks();
});

async function save(fields: FormFields): ReturnType<typeof runTaskHandler> {
  return runTaskHandler(
    handleSaveBoardPreferences,
    { boardPreferencesService },
    fields,
  );
}

it("saves the parsed board view of the signed-in user", async () => {
  const outcome = await save({ preferences: '{"view":"list"}' });

  expect(boardPreferencesService.save).toHaveBeenCalledExactlyOnceWith(
    ACTOR.id,
    { view: "list" },
  );
  expect(outcome.body).toEqual({ ok: true, intent: "save-board-preferences" });
});

it("refuses missing preferences without logging", async () => {
  const outcome = await save({});

  expect(outcome.status).toBe(400);
  expect(logCaughtError).not.toHaveBeenCalled();
  expect(boardPreferencesService.save).not.toHaveBeenCalled();
});

it("refuses text that is no JSON as invalid input", async () => {
  const outcome = await save({ preferences: "{view" });

  expect(outcome).toMatchObject({
    status: 400,
    body: { intent: "save-board-preferences", error: "invalidInput" },
  });
  expect(logCaughtError).toHaveBeenCalledWith(
    "task_board_actions",
    expect.any(SyntaxError),
  );
  expect(boardPreferencesService.save).not.toHaveBeenCalled();
});
