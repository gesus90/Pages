import { describe, expect, it, vi } from "vitest";

import { parseAvatarUpload } from "@/app/lib/settings-actions/avatar-upload.server";
import { handleSettingsAction } from "@/app/lib/settings-actions/settings-actions.server";
import { parseSettingsForm } from "@/app/lib/settings-actions/settings-form.server";
import { USER_NOTIFICATION_KEYS } from "@/definition/Settings";

import { createAccess } from "../helpers/authorization";
import { createUser } from "../helpers/factories";

import type { SettingsActionContext } from "@/app/lib/settings-actions/settings-action-support.server";

const NOTIFICATIONS = Object.fromEntries(
  USER_NOTIFICATION_KEYS.map((key) => [`notification.${key}`, "off"]),
);

const VALID_SETTINGS = {
  dateFormat: "YYYY-MM-DD",
  language: "en",
  timezone: "Europe/Berlin",
  weekStart: "monday",
  ...NOTIFICATIONS,
};

function createForm(entries: Record<string, string | File>): FormData {
  const formData = new FormData();

  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }

  return formData;
}

describe("parseSettingsForm", () => {
  it("reads a complete form, with on and off switches", () => {
    const form = createForm({
      ...VALID_SETTINGS,
      "notification.email": "on",
    });
    const settings = parseSettingsForm(form);

    expect(settings).toMatchObject({
      dateFormat: "YYYY-MM-DD",
      language: "en",
      timezone: "Europe/Berlin",
      weekStart: "monday",
    });
    expect(settings?.notifications.email).toBe(true);
    expect(settings?.notifications.desktop).toBe(false);
  });

  it("stores an empty timezone as no timezone", () => {
    expect(
      parseSettingsForm(createForm({ ...VALID_SETTINGS, timezone: "" }))
        ?.timezone,
    ).toBeNull();
  });

  it.each([
    ["an unknown language", { language: "fr" }],
    ["an unknown timezone", { timezone: "Mars/Olympus" }],
    ["a timezone sent as file", { timezone: new File(["x"], "x.txt") }],
    ["an unknown date format", { dateFormat: "DD-MM" }],
    ["an unknown start of the week", { weekStart: "friday" }],
    ["a switch that is neither on nor off", { "notification.email": "maybe" }],
  ])("rejects %s", (_label, override) => {
    expect(
      parseSettingsForm(createForm({ ...VALID_SETTINGS, ...override })),
    ).toBeNull();
  });

  it("rejects a form without the switches", () => {
    const { dateFormat, language, timezone, weekStart } = VALID_SETTINGS;

    expect(
      parseSettingsForm(
        createForm({ dateFormat, language, timezone, weekStart }),
      ),
    ).toBeNull();
  });
});

describe("parseAvatarUpload", () => {
  const PNG_BYTES = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1,
  ];

  it("names the file avatar when nothing of its name is safe", async () => {
    const upload = await parseAvatarUpload(
      new File([new Uint8Array(PNG_BYTES)], "§§§", { type: "image/png" }),
    );

    expect(upload).toMatchObject({
      avatar: { filename: "avatar", mimeType: "image/png" },
      status: "ready",
    });
  });

  it("keeps the safe characters of the file name", async () => {
    const upload = await parseAvatarUpload(
      new File([new Uint8Array(PNG_BYTES)], "my photo (1).png", {
        type: "image/png",
      }),
    );

    expect(upload).toMatchObject({ avatar: { filename: "myphoto1.png" } });
  });

  it.each([
    ["no file", "text"],
    ["an empty file", new File([], "empty.png", { type: "image/png" })],
  ])("reports %s as missing", async (_label, value) => {
    await expect(parseAvatarUpload(value)).resolves.toEqual({
      status: "missing",
    });
  });
});

describe("handleSettingsAction", () => {
  function createContext(
    formData: FormData,
    overrides: Partial<SettingsActionContext> = {},
  ): SettingsActionContext {
    return {
      formData,
      request: new Request("http://pages.invalid/settings", { method: "POST" }),
      services: {
        administrationService: {
          getContext: vi
            .fn()
            .mockResolvedValue(createAccess({ isAdmin: true, mode: "admin" })),
        },
        settingsService: { updateSettings: vi.fn() },
        userService: {
          updateOwnAvatar: vi.fn(),
          updateOwnProfile: vi.fn(),
        },
      } as unknown as SettingsActionContext["services"],
      user: createUser(),
      ...overrides,
    };
  }

  it.each([[null], ["unknown"], ["constructor"]])(
    "answers the intent %p with 400",
    async (intent) => {
      const failure = await handleSettingsAction(
        intent,
        createContext(new FormData()),
      ).catch((error: unknown) => error);

      expect((failure as Response).status).toBe(400);
    },
  );

  it("saves valid settings without a message", async () => {
    const context = createContext(createForm(VALID_SETTINGS));

    await expect(
      handleSettingsAction("update-settings", context),
    ).resolves.toBe(null);
    expect(
      context.services.settingsService.updateSettings,
    ).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ language: "en" }),
    );
  });

  it.each([
    ["an overlong display name", { displayName: "x".repeat(201) }],
    ["a blank display name", { displayName: "   " }],
    ["an overlong username", { username: "x".repeat(201) }],
    ["a username of just the @", { username: "@" }],
    [
      "an overlong email address",
      { email: `${"x".repeat(320)}@example.invalid` },
    ],
    ["a malformed email address", { email: "not-an-address" }],
  ])("rejects a profile with %s", async (_label, override) => {
    const context = createContext(
      createForm({
        displayName: "Anna",
        email: "anna@example.invalid",
        role: "admin",
        username: "anna",
        ...override,
      }),
    );
    const response = (await handleSettingsAction(
      "update-profile",
      context,
    )) as unknown as { data: unknown; init?: { status?: number } };

    expect(response.data).toEqual({
      error: "invalidInput",
      intent: "update-profile",
      ok: false,
    });
    expect(response.init?.status).toBe(400);
    expect(
      context.services.userService.updateOwnProfile,
    ).not.toHaveBeenCalled();
  });
});
