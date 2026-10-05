import { useTranslation } from "react-i18next";
import { useNavigation, useSubmit } from "react-router";

import { parseProfileDraft } from "@/app/components/settings/profile/profile-draft";
import {
  createAvatarFormData,
  createProfileFormData,
} from "@/app/components/settings/profile/profile-form-data";

import type { ProfileEditing } from "@/app/components/settings/profile/use-profile-editing";

/** The submissions of the profile card and whether they are running. */
export interface ProfileSubmission {
  readonly isProfileSubmitting: boolean;
  readonly isAvatarSubmitting: boolean;
  readonly saveProfile: () => void;
  /** Saves the picked avatar; `undefined` while no avatar is picked. */
  readonly saveAvatar: (() => void) | undefined;
}

/**
 * Submits profile edits and avatar changes to the settings action.
 *
 * @param editing - The edit state that is submitted.
 */
export function useProfileSubmission(
  editing: ProfileEditing,
): ProfileSubmission {
  const { t } = useTranslation();
  const submit = useSubmit();
  const navigation = useNavigation();
  const { avatar, draft, setError } = editing;
  const pickedAvatar = avatar.file;

  function isSubmitting(intent: string): boolean {
    return (
      navigation.state === "submitting" &&
      navigation.formData?.get("intent") === intent
    );
  }

  function submitMultipart(formData: FormData): void {
    setError(null);
    void submit(formData, { method: "post", encType: "multipart/form-data" });
  }

  function saveProfile(): void {
    const input = parseProfileDraft(draft);

    if (!input) {
      setError(t("settings.profile.errors.invalidInput"));
      return;
    }

    submitMultipart(createProfileFormData(input, pickedAvatar));
  }

  function saveAvatar(file: File): void {
    submitMultipart(createAvatarFormData(file));
  }

  return {
    isAvatarSubmitting: isSubmitting("update-avatar"),
    isProfileSubmitting: isSubmitting("update-profile"),
    saveAvatar: pickedAvatar ? () => saveAvatar(pickedAvatar) : undefined,
    saveProfile,
  };
}
