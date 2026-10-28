import { beforeEach, expect, it, vi } from "vitest";

import { handleUpdateTerminalScreenReader } from "@/app/lib/settings-actions/settings-terminal-action.server";

import {
  ACTOR,
  outcomeOf,
  settingsContext,
  thrownStatus,
} from "./action-fixtures";

import type { FormFields } from "./action-fixtures";

const updateTerminalScreenReader = vi.fn();
const services = { settingsService: { updateTerminalScreenReader } };

beforeEach(() => {
  vi.resetAllMocks();
});

it.each(["auto", "on", "off"])(
  "stores the mode %s for the signed-in user only",
  async (mode) => {
    const result = await handleUpdateTerminalScreenReader(
      settingsContext(services, { terminalScreenReader: mode, userId: "x" }),
    );

    expect(updateTerminalScreenReader).toHaveBeenCalledExactlyOnceWith(
      ACTOR.id,
      mode,
    );
    expect(await outcomeOf(result)).toMatchObject({
      status: 200,
      body: { intent: "update-terminal-screen-reader", ok: true },
    });
  },
);

it.each<FormFields>([{}, { terminalScreenReader: "loud" }])(
  "refuses the form %j",
  async (fields) => {
    const status = await thrownStatus(
      handleUpdateTerminalScreenReader(settingsContext(services, fields)),
    );

    expect(status).toBe(400);
    expect(updateTerminalScreenReader).not.toHaveBeenCalled();
  },
);
