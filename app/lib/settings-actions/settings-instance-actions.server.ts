import { data } from "react-router";

import { WikiValidationError } from "@/backend/error/WikiErrors";
import { InstanceSettingsDeniedError } from "@/backend/service/InstanceSettingsService";

import { readText } from "@/app/lib/form-fields.server";

import { parseLogoUpload } from "./logo-upload.server";
import { forbidden } from "./settings-action-support.server";

import type { WikiSettings } from "@/definition/Wiki";
import type {
  SettingsActionData,
  SettingsActionHandler,
} from "./settings-action-support.server";

/** Turns a failed instance action into the answer for the client. */
function failInstanceAction(
  error: unknown,
  failure: Extract<SettingsActionData, { readonly ok: false }>,
): ReturnType<typeof data<SettingsActionData>> {
  if (error instanceof InstanceSettingsDeniedError) {
    throw forbidden();
  }

  console.error("[pages] The instance settings could not be stored.", error);

  return data<SettingsActionData>(failure, { status: 500 });
}

/** Changes the company name; only administrators in the admin mode may. */
export const handleUpdateCompanyName: SettingsActionHandler = async ({
  user,
  formData,
  services,
}) => {
  const failure = {
    error: "general",
    intent: "update-company-name",
    ok: false,
  } as const;

  try {
    const isStored = await services.instanceSettingsService.updateCompanyName(
      user,
      readText(formData, "companyName") ?? "",
    );

    return isStored
      ? data<SettingsActionData>({ intent: "update-company-name", ok: true })
      : data<SettingsActionData>(
          { ...failure, error: "invalidName" },
          { status: 400 },
        );
  } catch (error: unknown) {
    return failInstanceAction(error, failure);
  }
};

/** Replaces the company logo; only administrators in the admin mode may. */
export const handleUpdateLogo: SettingsActionHandler = async ({
  user,
  formData,
  services,
}) => {
  const upload = await parseLogoUpload(formData.get("logo"));

  if (upload.status !== "ready") {
    return data<SettingsActionData>(
      {
        error: upload.status === "missing" ? "missing" : "invalidLogo",
        intent: "update-logo",
        ok: false,
      },
      { status: 400 },
    );
  }

  try {
    await services.instanceSettingsService.replaceLogo(user, upload.logo);

    return data<SettingsActionData>({ intent: "update-logo", ok: true });
  } catch (error: unknown) {
    return failInstanceAction(error, {
      error: "general",
      intent: "update-logo",
      ok: false,
    });
  }
};

/** Removes the company logo; only administrators in the admin mode may. */
export const handleRemoveLogo: SettingsActionHandler = async ({
  user,
  services,
}) => {
  try {
    await services.instanceSettingsService.removeLogo(user);

    return data<SettingsActionData>({ intent: "remove-logo", ok: true });
  } catch (error: unknown) {
    return failInstanceAction(error, { intent: "remove-logo", ok: false });
  }
};

const MEBIBYTE = 1024 * 1024;

function readNumber(formData: FormData, name: string, factor = 1): number {
  const value = (readText(formData, name) ?? "").trim();

  return /^\d+$/u.test(value) ? Number(value) * factor : Number.NaN;
}

/** Changes the wiki retention times and upload limits; administrators only. */
export const handleUpdateWikiSettings: SettingsActionHandler = async ({
  user,
  formData,
  services,
}) => {
  const failure = {
    error: "general",
    intent: "update-wiki-settings",
    ok: false,
  } as const;
  const settings: WikiSettings = {
    fileLimitBytes: readNumber(formData, "fileLimitMegabytes", MEBIBYTE),
    mediaLimitBytes: readNumber(formData, "mediaLimitMegabytes", MEBIBYTE),
    trashRetentionDays: readNumber(formData, "trashRetentionDays"),
    versionKeepLast: readNumber(formData, "versionKeepLast"),
    versionRetentionDays: readNumber(formData, "versionRetentionDays"),
  };

  try {
    await services.wikiService.updateSettings(user, settings);

    return data<SettingsActionData>({
      intent: "update-wiki-settings",
      ok: true,
    });
  } catch (error: unknown) {
    if (error instanceof WikiValidationError) {
      return data<SettingsActionData>(
        { ...failure, error: "invalidSetting" },
        { status: 400 },
      );
    }

    return failInstanceAction(error, failure);
  }
};
