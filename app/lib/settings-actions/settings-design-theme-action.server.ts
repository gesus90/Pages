import { data } from "react-router";

import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import { badRequest } from "./settings-action-support.server";

import type {
  SettingsActionData,
  SettingsActionHandler,
} from "./settings-action-support.server";

/**
 * Stores the design theme of the signed-in user and of nobody else.
 *
 * @remarks
 * The account comes from the session; the form carries no user. An unknown or
 * removed theme is refused with an answer the page shows, because a theme can
 * disappear while the page is open.
 */
export const handleUpdateDesignTheme: SettingsActionHandler = async ({
  user,
  formData,
  services,
}) => {
  const designThemeId = formData.get("designTheme");

  if (typeof designThemeId !== "string") {
    throw badRequest();
  }

  try {
    const result = await services.designThemeService.select(
      user.id,
      designThemeId,
    );

    return result === "saved"
      ? data<SettingsActionData>({ intent: "update-design-theme", ok: true })
      : data<SettingsActionData>(
          { error: "unknownTheme", intent: "update-design-theme", ok: false },
          { status: 409 },
        );
  } catch (error: unknown) {
    logCaughtError("settings_design_theme_action", error);
    logDiagnostic(
      "settings_design_theme_action",
      "error",
      "[pages] The design theme could not be stored.",
      error,
    );

    return data<SettingsActionData>(
      { error: "general", intent: "update-design-theme", ok: false },
      { status: 500 },
    );
  }
};
