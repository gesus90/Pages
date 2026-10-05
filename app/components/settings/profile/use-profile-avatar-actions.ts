import { useTranslation } from "react-i18next";

import {
  MAXIMUM_AVATAR_BYTES,
  SUPPORTED_AVATAR_MIME_TYPES,
} from "@/definition/User";

import type { ProfileEditing } from "@/app/components/settings/profile/use-profile-editing";
import type { ChangeEvent } from "react";

interface ProfileAvatarActionsOptions {
  readonly canEditProfile: boolean;
  readonly editing: ProfileEditing;
}

/** The events of the avatar picker of the profile card. */
export interface ProfileAvatarActions {
  readonly handleAvatarClick: () => void;
  readonly handleAvatarFileChange: (
    event: ChangeEvent<HTMLInputElement>,
  ) => void;
}

function isAcceptableAvatarFile(file: File): boolean {
  return (
    SUPPORTED_AVATAR_MIME_TYPES.has(file.type) &&
    file.size <= MAXIMUM_AVATAR_BYTES
  );
}

/**
 * Handles opening the avatar picker and validating the picked file.
 *
 * @param options - Whether the profile is editable, and its edit state.
 *
 * @remarks
 * Picking an avatar starts the edit mode for users who may edit their profile.
 */
export function useProfileAvatarActions({
  canEditProfile,
  editing,
}: ProfileAvatarActionsOptions): ProfileAvatarActions {
  const { t } = useTranslation();
  const { avatar, isEditing, setError, startEdit } = editing;

  function startEditIfAllowed(): void {
    if (canEditProfile && !isEditing) {
      startEdit();
    }
  }

  function handleAvatarClick(): void {
    startEditIfAllowed();
    avatar.inputRef.current?.click();
  }

  function handleAvatarFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!isAcceptableAvatarFile(file)) {
      setError(t("settings.profile.errors.invalidAvatar"));
      return;
    }

    startEditIfAllowed();
    avatar.select(file);
    setError(null);
  }

  return { handleAvatarClick, handleAvatarFileChange };
}
