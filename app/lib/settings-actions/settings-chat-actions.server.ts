import { data } from "react-router";

import { ChatError } from "@/backend/error/ChatErrors";
import { InstanceSettingsDeniedError } from "@/backend/service/InstanceSettingsService";
import { readText } from "@/app/lib/form-fields.server";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import { forbidden } from "./settings-action-support.server";

import type {
  SettingsActionData,
  SettingsActionHandler,
} from "./settings-action-support.server";

function readMegabytes(formData: FormData): number {
  const value = (readText(formData, "attachmentLimitMegabytes") ?? "").trim();

  return /^\d+$/u.test(value) ? Number(value) : Number.NaN;
}

/**
 * Changes the attachment limit and the supplementary instruction of the chat
 * (T6.12.4, T6.12.8); administrators in the admin mode only.
 *
 * @remarks
 * `resetInstruction` removes the supplement; Pica's protected `SOUL.md` and
 * `AGENTS.md` are not part of the form (PAGE-51). Neither the supplement nor
 * any other content of the form is logged.
 */
export const handleUpdateChatSettings: SettingsActionHandler = async ({
  user,
  formData,
  services,
}) => {
  const isReset = readText(formData, "resetInstruction") === "true";

  try {
    await services.chatSettingsService.update(user, {
      attachmentLimitMegabytes: readMegabytes(formData),
      systemInstruction: isReset
        ? null
        : (readText(formData, "systemInstruction") ?? ""),
    });

    return data<SettingsActionData>({
      intent: "update-chat-settings",
      ok: true,
    });
  } catch (error: unknown) {
    logCaughtError("settings_chat_actions", error);

    if (error instanceof InstanceSettingsDeniedError) {
      throw forbidden();
    }

    if (error instanceof ChatError) {
      return data<SettingsActionData>(
        {
          error:
            error.code === "credentialsInText"
              ? "credentialsInText"
              : "invalidSetting",
          intent: "update-chat-settings",
          ok: false,
        },
        { status: 400 },
      );
    }

    logDiagnostic(
      "settings_chat_actions",
      "error",
      "[pages] The chat settings could not be stored.",
      error,
    );

    return data<SettingsActionData>(
      { error: "general", intent: "update-chat-settings", ok: false },
      { status: 500 },
    );
  }
};
