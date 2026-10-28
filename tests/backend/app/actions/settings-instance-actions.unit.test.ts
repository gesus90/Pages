import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleUpdateChatSettings } from "@/app/lib/settings-actions/settings-chat-actions.server";
import {
  handleRemoveLogo,
  handleUpdateCompanyName,
  handleUpdateLogo,
  handleUpdateWikiSettings,
} from "@/app/lib/settings-actions/settings-instance-actions.server";
import { ChatError } from "@/backend/error/ChatErrors";
import { WikiValidationError } from "@/backend/error/WikiErrors";
import { InstanceSettingsDeniedError } from "@/backend/service/InstanceSettingsService";

import {
  ACTOR,
  callArgument,
  outcomeOf,
  settingsContext,
  thrownStatus,
} from "./action-fixtures";
import { jpegBytes, uploadedFile } from "./image-fixtures";

import type { MockInstance } from "vitest";
import type { SettingsActionHandler } from "@/app/lib/settings-actions/settings-action-support.server";
import type { ActionOutcome, FormFields } from "./action-fixtures";

const services = {
  instanceSettingsService: {
    updateCompanyName: vi.fn(),
    replaceLogo: vi.fn(),
    removeLogo: vi.fn(),
  },
  wikiService: { updateSettings: vi.fn() },
  chatSettingsService: { update: vi.fn() },
};

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function run(
  handler: SettingsActionHandler,
  fields: FormFields = {},
): Promise<ActionOutcome> {
  return outcomeOf(await handler(settingsContext(services, fields)));
}

function silenceErrors(): MockInstance<typeof console.error> {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("handleUpdateCompanyName", () => {
  it("stores the name for the signed-in user", async () => {
    services.instanceSettingsService.updateCompanyName.mockResolvedValue(true);

    const outcome = await run(handleUpdateCompanyName, { companyName: "ACME" });

    expect(outcome.body).toEqual({ intent: "update-company-name", ok: true });
    expect(
      services.instanceSettingsService.updateCompanyName,
    ).toHaveBeenCalledWith(ACTOR, "ACME");
  });

  it("reports a name the service refuses as invalid", async () => {
    services.instanceSettingsService.updateCompanyName.mockResolvedValue(false);

    const outcome = await run(handleUpdateCompanyName, { companyName: " " });

    expect(outcome.status).toBe(400);
    expect(outcome.body).toEqual({
      intent: "update-company-name",
      ok: false,
      error: "invalidName",
    });
  });

  it("asks with an empty name when the field is absent", async () => {
    services.instanceSettingsService.updateCompanyName.mockResolvedValue(false);

    await run(handleUpdateCompanyName);

    expect(
      services.instanceSettingsService.updateCompanyName,
    ).toHaveBeenCalledWith(ACTOR, "");
  });

  it("answers 403 when the actor may not change the instance", async () => {
    services.instanceSettingsService.updateCompanyName.mockRejectedValue(
      new InstanceSettingsDeniedError(),
    );

    const status = await thrownStatus(
      handleUpdateCompanyName(
        settingsContext(services, { companyName: "ACME" }),
      ),
    );

    expect(status).toBe(403);
  });

  it("answers 500 and logs without leaking the failure to the client", async () => {
    const logged = silenceErrors();
    services.instanceSettingsService.updateCompanyName.mockRejectedValue(
      new Error("secret path /srv/pages"),
    );

    const outcome = await run(handleUpdateCompanyName, { companyName: "ACME" });

    expect(outcome.status).toBe(500);
    expect(outcome.body).toEqual({
      intent: "update-company-name",
      ok: false,
      error: "general",
    });
    expect(logged).toHaveBeenCalledOnce();
  });
});

describe("handleUpdateLogo", () => {
  it("replaces the logo with the validated image", async () => {
    const logo = uploadedFile(jpegBytes(), "logo.jpg", "image/jpeg");

    const outcome = await run(handleUpdateLogo, { logo });

    expect(outcome.body).toEqual({ intent: "update-logo", ok: true });
    expect(services.instanceSettingsService.replaceLogo).toHaveBeenCalledWith(
      ACTOR,
      expect.objectContaining({ mimeType: "image/jpeg" }),
    );
  });

  it("reports a missing file", async () => {
    const outcome = await run(handleUpdateLogo);

    expect(outcome.status).toBe(400);
    expect(outcome.body).toMatchObject({ error: "missing" });
    expect(services.instanceSettingsService.replaceLogo).not.toHaveBeenCalled();
  });

  it("reports an unusable file without storing it", async () => {
    const script = uploadedFile(
      new TextEncoder().encode("<svg><script>1</script></svg>"),
      "logo.svg",
      "image/svg+xml",
    );

    const outcome = await run(handleUpdateLogo, { logo: script });

    expect(outcome.status).toBe(400);
    expect(outcome.body).toMatchObject({ error: "invalidLogo" });
    expect(services.instanceSettingsService.replaceLogo).not.toHaveBeenCalled();
  });

  it("answers 403 when the actor may not change the instance", async () => {
    services.instanceSettingsService.replaceLogo.mockRejectedValue(
      new InstanceSettingsDeniedError(),
    );
    const logo = uploadedFile(jpegBytes(), "logo.jpg", "image/jpeg");

    const status = await thrownStatus(
      handleUpdateLogo(settingsContext(services, { logo })),
    );

    expect(status).toBe(403);
  });

  it("answers 500 for a storage failure", async () => {
    silenceErrors();
    services.instanceSettingsService.replaceLogo.mockRejectedValue(
      new Error("disk full"),
    );
    const logo = uploadedFile(jpegBytes(), "logo.jpg", "image/jpeg");

    const outcome = await run(handleUpdateLogo, { logo });

    expect(outcome.status).toBe(500);
    expect(outcome.body).toMatchObject({ error: "general" });
  });
});

describe("handleRemoveLogo", () => {
  it("removes the logo", async () => {
    const outcome = await run(handleRemoveLogo);

    expect(outcome.body).toEqual({ intent: "remove-logo", ok: true });
    expect(services.instanceSettingsService.removeLogo).toHaveBeenCalledWith(
      ACTOR,
    );
  });

  it("answers 403 when the actor may not change the instance", async () => {
    services.instanceSettingsService.removeLogo.mockRejectedValue(
      new InstanceSettingsDeniedError(),
    );

    const status = await thrownStatus(
      handleRemoveLogo(settingsContext(services, {})),
    );

    expect(status).toBe(403);
  });

  it("answers 500 for a storage failure", async () => {
    silenceErrors();
    services.instanceSettingsService.removeLogo.mockRejectedValue(
      new Error("disk full"),
    );

    const outcome = await run(handleRemoveLogo);

    expect(outcome.status).toBe(500);
    expect(outcome.body).toEqual({ intent: "remove-logo", ok: false });
  });
});

describe("handleUpdateWikiSettings", () => {
  const fields = {
    fileLimitMegabytes: "20",
    mediaLimitMegabytes: " 5 ",
    trashRetentionDays: "30",
    versionKeepLast: "10",
    versionRetentionDays: "90",
  };

  it("converts megabytes to bytes and passes the days on", async () => {
    const outcome = await run(handleUpdateWikiSettings, fields);

    expect(outcome.body).toEqual({ intent: "update-wiki-settings", ok: true });
    expect(services.wikiService.updateSettings).toHaveBeenCalledWith(ACTOR, {
      fileLimitBytes: 20 * 1024 * 1024,
      mediaLimitBytes: 5 * 1024 * 1024,
      trashRetentionDays: 30,
      versionKeepLast: 10,
      versionRetentionDays: 90,
    });
  });

  it.each(["-1", "1.5", "1e3", "abc", "", "0x10", "٣"])(
    "hands %j over as not a number so the service refuses it",
    async (value) => {
      await run(handleUpdateWikiSettings, {
        ...fields,
        trashRetentionDays: value,
      });

      const settings = callArgument(services.wikiService.updateSettings, 0, 1);

      expect(settings).toHaveProperty("trashRetentionDays", Number.NaN);
    },
  );

  it("hands an absent field over as not a number", async () => {
    await run(handleUpdateWikiSettings, {
      fileLimitMegabytes: "20",
      mediaLimitMegabytes: "5",
      trashRetentionDays: "30",
      versionRetentionDays: "90",
    });

    const settings = callArgument(services.wikiService.updateSettings, 0, 1);

    expect(settings).toHaveProperty("versionKeepLast", Number.NaN);
    expect(settings).toHaveProperty("versionRetentionDays", 90);
  });

  it("reports a rejected setting as invalid", async () => {
    services.wikiService.updateSettings.mockRejectedValue(
      new WikiValidationError("invalidSetting"),
    );

    const outcome = await run(handleUpdateWikiSettings, fields);

    expect(outcome.status).toBe(400);
    expect(outcome.body).toEqual({
      intent: "update-wiki-settings",
      ok: false,
      error: "invalidSetting",
    });
  });

  it("answers 403 for an actor without the right", async () => {
    services.wikiService.updateSettings.mockRejectedValue(
      new InstanceSettingsDeniedError(),
    );

    const status = await thrownStatus(
      handleUpdateWikiSettings(settingsContext(services, fields)),
    );

    expect(status).toBe(403);
  });
});

describe("handleUpdateChatSettings", () => {
  const fields = {
    attachmentLimitMegabytes: "8",
    systemInstruction: "Be brief.",
  };

  it("stores the limit and the instruction", async () => {
    const outcome = await run(handleUpdateChatSettings, fields);

    expect(outcome.body).toEqual({ intent: "update-chat-settings", ok: true });
    expect(services.chatSettingsService.update).toHaveBeenCalledWith(ACTOR, {
      attachmentLimitMegabytes: 8,
      systemInstruction: "Be brief.",
    });
  });

  it("removes the supplement on reset", async () => {
    await run(handleUpdateChatSettings, {
      ...fields,
      resetInstruction: "true",
    });

    expect(callArgument(services.chatSettingsService.update, 0, 1)).toEqual({
      attachmentLimitMegabytes: 8,
      systemInstruction: null,
    });
  });

  it("hands an unreadable limit over as not a number", async () => {
    await run(handleUpdateChatSettings, {
      ...fields,
      attachmentLimitMegabytes: "8 MB",
    });

    expect(
      callArgument(services.chatSettingsService.update, 0, 1),
    ).toHaveProperty("attachmentLimitMegabytes", Number.NaN);
  });

  it("hands absent fields over as an unreadable limit and an empty supplement", async () => {
    await run(handleUpdateChatSettings, {});

    expect(callArgument(services.chatSettingsService.update, 0, 1)).toEqual({
      attachmentLimitMegabytes: Number.NaN,
      systemInstruction: "",
    });
  });

  it.each([
    ["credentialsInText", "credentialsInText"],
    ["invalidInput", "invalidSetting"],
    ["fileTooLarge", "invalidSetting"],
  ] as const)("maps the chat error %s to %s", async (code, error) => {
    services.chatSettingsService.update.mockRejectedValue(new ChatError(code));

    const outcome = await run(handleUpdateChatSettings, fields);

    expect(outcome.status).toBe(400);
    expect(outcome.body).toEqual({
      intent: "update-chat-settings",
      ok: false,
      error,
    });
  });

  it("answers 403 for an actor without the right", async () => {
    services.chatSettingsService.update.mockRejectedValue(
      new InstanceSettingsDeniedError(),
    );

    const status = await thrownStatus(
      handleUpdateChatSettings(settingsContext(services, fields)),
    );

    expect(status).toBe(403);
  });

  it("logs safe structured errors, never the instruction or the message", async () => {
    const logged = silenceErrors();
    services.chatSettingsService.update.mockRejectedValue(
      new Error("rejected instruction: sk-synthetic-secret"),
    );

    const outcome = await run(handleUpdateChatSettings, fields);

    expect(outcome.status).toBe(500);
    expect(outcome.body).toMatchObject({ error: "general" });
    expect(JSON.stringify(logged.mock.calls)).not.toContain("sk-synthetic");
    expect(logged).toHaveBeenCalledWith(
      "[pages] The chat settings could not be stored.",
      expect.objectContaining({
        type: "Error",
        message:
          "Error reported; free-form diagnostic text omitted to protect user content",
      }),
    );
  });
});
