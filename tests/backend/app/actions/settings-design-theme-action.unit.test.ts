import { beforeEach, expect, it, vi } from "vitest";

import { handleUpdateDesignTheme } from "@/app/lib/settings-actions/settings-design-theme-action.server";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import {
  ACTOR,
  outcomeOf,
  settingsContext,
  thrownStatus,
} from "./action-fixtures";

import type { ActionOutcome, FormFields } from "./action-fixtures";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
}));

const select = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
});

async function run(fields: FormFields): Promise<ActionOutcome> {
  return outcomeOf(
    await handleUpdateDesignTheme(
      settingsContext({ designThemeService: { select } }, fields),
    ),
  );
}

it("stores the chosen theme for the signed-in user only", async () => {
  select.mockResolvedValue("saved");

  const outcome = await run({ designTheme: "arctic-ice", userId: "other" });

  expect(select).toHaveBeenCalledExactlyOnceWith(ACTOR.id, "arctic-ice");
  expect(outcome.status).toBe(200);
  expect(outcome.body).toEqual({ intent: "update-design-theme", ok: true });
});

it("answers a theme that disappeared with a visible 409", async () => {
  select.mockResolvedValue("unknown");

  const outcome = await run({ designTheme: "removed" });

  expect(outcome.status).toBe(409);
  expect(outcome.body).toEqual({
    error: "unknownTheme",
    intent: "update-design-theme",
    ok: false,
  });
});

it("refuses a submission without a theme", async () => {
  const status = await thrownStatus(
    handleUpdateDesignTheme(
      settingsContext({ designThemeService: { select } }, {}),
    ),
  );

  expect(status).toBe(400);
  expect(select).not.toHaveBeenCalled();
});

it("answers a storage failure with a logged general error", async () => {
  const failure = new Error("database unavailable");
  select.mockRejectedValue(failure);

  const outcome = await run({ designTheme: "standard" });

  expect(outcome.status).toBe(500);
  expect(outcome.body).toEqual({
    error: "general",
    intent: "update-design-theme",
    ok: false,
  });
  expect(logCaughtError).toHaveBeenCalledWith(
    "settings_design_theme_action",
    failure,
  );
  expect(logDiagnostic).toHaveBeenCalledWith(
    "settings_design_theme_action",
    "error",
    "[pages] The design theme could not be stored.",
    failure,
  );
});
