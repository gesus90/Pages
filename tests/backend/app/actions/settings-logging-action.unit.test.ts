import { beforeEach, expect, it, vi } from "vitest";

import { handleUpdateLogging } from "@/app/lib/settings-actions/settings-logging-action.server";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { ServerSettingsDeniedError } from "@/backend/service/ServerSettingsService";

import {
  ACTOR,
  callArgument,
  outcomeOf,
  settingsContext,
  thrownStatus,
} from "./action-fixtures";

import type { ServerSettingsService } from "@/backend/service/ServerSettingsService";
import type { ActionOutcome, FormFields } from "./action-fixtures";

vi.mock(import("@/backend/logging/Logger"), async (importOriginal) => ({
  ...(await importOriginal()),
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

const getContext = vi.fn();
const updateLogging = vi.fn();

const ADMIN_MODE = { isActive: true, isAdmin: true, mode: "admin" };

beforeEach(() => {
  vi.resetAllMocks();
  getContext.mockResolvedValue(ADMIN_MODE);
});

// The service has private members, so a fake only offers what the handler calls.
function service(): ServerSettingsService {
  const fake: object = { updateLogging };

  return fake as ServerSettingsService;
}

function context(fields: FormFields): ReturnType<typeof settingsContext> {
  return settingsContext({ administrationService: { getContext } }, fields);
}

async function submit(fields: FormFields): Promise<ActionOutcome> {
  return outcomeOf(await handleUpdateLogging(context(fields), service()));
}

it("stores the trimmed retention of a system administrator", async () => {
  updateLogging.mockResolvedValue(true);

  const outcome = await submit({ logRetentionDays: " 14 " });

  expect(getContext).toHaveBeenCalledWith(ACTOR.id);
  expect(updateLogging).toHaveBeenCalledExactlyOnceWith(ACTOR, 14);
  expect(outcome).toMatchObject({
    status: 200,
    body: { intent: "update-logging", ok: true, retentionDays: 14 },
  });
});

it.each([
  ["a negative number", { logRetentionDays: "-1" }],
  ["a decimal", { logRetentionDays: "1.5" }],
  ["a word", { logRetentionDays: "week" }],
  ["a missing field", {}],
  ["a file", { logRetentionDays: new File(["7"], "days.txt") }],
])("hands %s to the service as not a number", async (caseName, fields) => {
  updateLogging.mockResolvedValue(false);

  const outcome = await submit(fields);

  expect(callArgument(updateLogging, 0, 1)).toBeNaN();
  expect(outcome).toMatchObject({
    status: 400,
    body: { intent: "update-logging", ok: false, error: "invalidSetting" },
  });
});

it("refuses an administrator who works in the role mode", async () => {
  getContext.mockResolvedValue({ ...ADMIN_MODE, mode: "role" });

  const status = await thrownStatus(
    handleUpdateLogging(context({ logRetentionDays: "7" }), service()),
  );

  expect(status).toBe(403);
  expect(updateLogging).not.toHaveBeenCalled();
});

it("refuses an account without the admin permission", async () => {
  getContext.mockResolvedValue({ ...ADMIN_MODE, isAdmin: false });

  const status = await thrownStatus(
    handleUpdateLogging(context({ logRetentionDays: "7" }), service()),
  );

  expect(status).toBe(403);
  expect(updateLogging).not.toHaveBeenCalled();
});

it("answers 403 when the service denies the change", async () => {
  updateLogging.mockRejectedValue(new ServerSettingsDeniedError());

  const status = await thrownStatus(
    handleUpdateLogging(context({ logRetentionDays: "7" }), service()),
  );

  expect(status).toBe(403);
  expect(logCaughtError).toHaveBeenCalledOnce();
  expect(logEvent).not.toHaveBeenCalled();
});

it("answers 500 and logs a failed save", async () => {
  const failure = new Error("read-only file system");
  updateLogging.mockRejectedValue(failure);

  const outcome = await submit({ logRetentionDays: "7" });

  expect(outcome).toMatchObject({
    status: 500,
    body: { intent: "update-logging", ok: false, error: "general" },
  });
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      level: "error",
      event: "logging.retention.save_failed",
      error: failure,
    }),
  );
});
