import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleChangePassword,
  handleRevokeOtherSessions,
  handleRevokeSession,
  handleUpdateSettings,
} from "@/app/lib/settings-actions/settings-account-actions.server";
import { USER_NOTIFICATION_KEYS } from "@/definition/Settings";

import { sessionCookieHeader } from "../server-lib/request-fixtures";
import {
  ACTOR,
  callArgument,
  formOf,
  outcomeOf,
  servicesOf,
  thrownStatus,
} from "./action-fixtures";

import type { SettingsActionContext } from "@/app/lib/settings-actions/settings-action-support.server";
import type { FormFields } from "./action-fixtures";

const services = {
  authService: { changePassword: vi.fn() },
  sessionService: { revokeSessionById: vi.fn(), revokeOtherSessions: vi.fn() },
  settingsService: { updateSettings: vi.fn() },
};

beforeEach(() => {
  vi.resetAllMocks();
});

async function contextOf(
  fields: FormFields,
  token: string | null = "token-1",
): Promise<SettingsActionContext> {
  const headers: Record<string, string> = {};

  if (token !== null) {
    headers.Cookie = await sessionCookieHeader(token);
  }

  return {
    formData: formOf(fields),
    request: new Request("http://pages.invalid/settings", {
      headers,
      method: "POST",
    }),
    services: servicesOf(services),
    user: ACTOR,
  };
}

function settingsFields(change: FormFields = {}): FormFields {
  const notifications = Object.fromEntries(
    USER_NOTIFICATION_KEYS.map((key) => [`notification.${key}`, "off"]),
  );

  return {
    language: "en",
    theme: "dark",
    timezone: "Europe/Berlin",
    dateFormat: "YYYY-MM-DD",
    weekStart: "sunday",
    ...notifications,
    "notification.email": "on",
    ...change,
  };
}

describe("handleUpdateSettings", () => {
  it("stores the parsed preferences for the signed-in user", async () => {
    services.settingsService.updateSettings.mockResolvedValue(undefined);

    const result = await handleUpdateSettings(
      await contextOf(settingsFields()),
    );

    expect(result).toBeNull();
    const [userId, settings] = services.settingsService.updateSettings.mock
      .calls[0] as [string, unknown];
    expect(userId).toBe(ACTOR.id);
    expect(settings).toMatchObject({
      language: "en",
      theme: "dark",
      timezone: "Europe/Berlin",
      dateFormat: "YYYY-MM-DD",
      weekStart: "sunday",
      notifications: { email: true, desktop: false, weeklySummary: false },
    });
  });

  it("stores no time zone for an empty selection", async () => {
    await handleUpdateSettings(
      await contextOf(settingsFields({ timezone: "" })),
    );

    expect(
      callArgument(services.settingsService.updateSettings, 0, 1),
    ).toMatchObject({
      timezone: null,
    });
  });

  it.each([
    ["an unknown language", { language: "fr" }],
    ["an unknown theme", { theme: "neon" }],
    ["an unknown time zone", { timezone: "Mars/Olympus" }],
    ["a missing time zone", { timezone: new File(["x"], "x") }],
    ["an unknown date format", { dateFormat: "DD-MM" }],
    ["an unknown week start", { weekStart: "friday" }],
    [
      "a notification switch that is neither on nor off",
      { "notification.email": "yes" },
    ],
  ])("answers 400 for %s", async (caseName, change) => {
    const status = await thrownStatus(
      handleUpdateSettings(await contextOf(settingsFields(change))),
    );

    expect(status).toBe(400);
    expect(services.settingsService.updateSettings).not.toHaveBeenCalled();
  });

  it("answers 400 when a notification switch is missing", async () => {
    const fields = Object.fromEntries(
      Object.entries(settingsFields()).filter(
        ([name]) => name !== "notification.weeklySummary",
      ),
    );

    const status = await thrownStatus(
      handleUpdateSettings(await contextOf(fields)),
    );

    expect(status).toBe(400);
    expect(services.settingsService.updateSettings).not.toHaveBeenCalled();
  });
});

describe("handleChangePassword", () => {
  const valid = {
    currentPassword: "old-password",
    newPassword: "new-password-1",
    passwordConfirmation: "new-password-1",
  };

  it("passes the account, the passwords and the current session on", async () => {
    services.authService.changePassword.mockResolvedValue("success");

    const outcome = await outcomeOf(
      await handleChangePassword(await contextOf(valid)),
    );

    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({
      intent: "change-password",
      outcome: "success",
    });
    expect(services.authService.changePassword).toHaveBeenCalledWith(
      ACTOR.username,
      "old-password",
      "new-password-1",
      "token-1",
    );
  });

  it("passes no session when the request has none", async () => {
    services.authService.changePassword.mockResolvedValue("success");

    await handleChangePassword(await contextOf(valid, null));

    expect(callArgument(services.authService.changePassword, 0, 3)).toBeNull();
  });

  it.each(["invalidCurrent", "unchanged"])(
    "reports the service outcome %s with status 400",
    async (serviceOutcome) => {
      services.authService.changePassword.mockResolvedValue(serviceOutcome);

      const outcome = await outcomeOf(
        await handleChangePassword(await contextOf(valid)),
      );

      expect(outcome.status).toBe(400);
      expect(outcome.body).toEqual({
        intent: "change-password",
        outcome: serviceOutcome,
      });
    },
  );

  it.each([
    [
      "a missing current password",
      { currentPassword: undefined },
      "invalidInput",
    ],
    [
      "a missing confirmation",
      { passwordConfirmation: undefined },
      "invalidInput",
    ],
    ["a too long password", { newPassword: "p".repeat(1000) }, "invalidInput"],
    [
      "a too short password",
      { newPassword: "short", passwordConfirmation: "short" },
      "tooShort",
    ],
    [
      "a different confirmation",
      { passwordConfirmation: "other-password" },
      "mismatch",
    ],
  ])(
    "rejects %s without asking the service",
    async (caseName, change, expected) => {
      const fields = Object.fromEntries(
        Object.entries({ ...valid, ...change }).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      );

      const outcome = await outcomeOf(
        await handleChangePassword(await contextOf(fields)),
      );

      expect(outcome.status).toBe(400);
      expect(outcome.body).toEqual({
        intent: "change-password",
        outcome: expected,
      });
      expect(services.authService.changePassword).not.toHaveBeenCalled();
    },
  );

  it("accepts a password of exactly the minimum length", async () => {
    services.authService.changePassword.mockResolvedValue("success");

    const outcome = await outcomeOf(
      await handleChangePassword(
        await contextOf({
          ...valid,
          newPassword: "12345678",
          passwordConfirmation: "12345678",
        }),
      ),
    );

    expect(outcome.status).toBe(200);
  });
});

describe("handleRevokeSession", () => {
  it("revokes the named session and protects the current one", async () => {
    services.sessionService.revokeSessionById.mockResolvedValue(true);

    const outcome = await outcomeOf(
      await handleRevokeSession(await contextOf({ sessionId: "s2" })),
    );

    expect(outcome.body).toEqual({ intent: "revoke-session" });
    expect(services.sessionService.revokeSessionById).toHaveBeenCalledWith(
      ACTOR.id,
      "s2",
      "token-1",
    );
  });

  it.each<FormFields>([
    {},
    { sessionId: "" },
    { sessionId: new File(["s"], "s") },
  ])("answers 400 for the form %j without revoking", async (fields) => {
    const status = await thrownStatus(
      handleRevokeSession(await contextOf(fields)),
    );

    expect(status).toBe(400);
    expect(services.sessionService.revokeSessionById).not.toHaveBeenCalled();
  });

  it("answers 400 for a session that cannot be revoked", async () => {
    services.sessionService.revokeSessionById.mockResolvedValue(false);

    const status = await thrownStatus(
      handleRevokeSession(await contextOf({ sessionId: "foreign" })),
    );

    expect(status).toBe(400);
  });
});

describe("handleRevokeOtherSessions", () => {
  it("keeps only the requesting browser signed in", async () => {
    const outcome = await outcomeOf(
      await handleRevokeOtherSessions(await contextOf({})),
    );

    expect(outcome.body).toEqual({ intent: "revoke-other-sessions" });
    expect(services.sessionService.revokeOtherSessions).toHaveBeenCalledWith(
      ACTOR.id,
      "token-1",
    );
  });
});
