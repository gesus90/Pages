import { useState } from "react";

import {
  createProfileDraft,
  hasProfileChanges,
} from "@/app/components/settings/profile/profile-draft";
import { useProfileFeedback } from "@/app/components/settings/profile/use-profile-feedback";
import { useAvatarSelection } from "@/app/components/settings/use-avatar-selection";

import type { ProfileDraft } from "@/app/components/settings/profile-edit-form";
import type { AvatarSelection } from "@/app/components/settings/use-avatar-selection";
import type { Role } from "@/definition/Role";
import type { User } from "@/definition/User";

interface ProfileEditingOptions {
  readonly user: User;
  readonly email: string | null;
}

/** The edit mode, the draft and the picked avatar of the profile card. */
export interface ProfileEditing {
  readonly avatar: AvatarSelection;
  readonly isEditing: boolean;
  readonly draft: ProfileDraft;
  readonly error: string | null;
  /** Whether the draft or the picked avatar differs from what is stored. */
  readonly canSave: boolean;
  readonly setError: (message: string | null) => void;
  /** Starts an edit from the stored profile and forgets any picked avatar. */
  readonly startEdit: () => void;
  readonly cancelEdit: () => void;
  readonly cancelAvatar: () => void;
  readonly changeDraft: (changes: Partial<ProfileDraft>) => void;
  readonly changeRole: (role: Role) => void;
}

/**
 * Keeps the edit mode, the draft, the picked avatar and the error message of
 * the profile card together.
 *
 * @param options - The profile that is shown and edited.
 */
export function useProfileEditing({
  user,
  email,
}: ProfileEditingOptions): ProfileEditing {
  const avatar = useAvatarSelection();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<ProfileDraft>(
    createProfileDraft(user, email),
  );
  const [error, setError] = useState<string | null>(null);

  function startEdit(): void {
    setDraft(createProfileDraft(user, email));
    avatar.clear();
    setError(null);
    setIsEditing(true);
  }

  function cancelEdit(): void {
    avatar.clear();
    setError(null);
    setIsEditing(false);
  }

  function cancelAvatar(): void {
    avatar.clear();
    setError(null);
  }

  function changeDraft(changes: Partial<ProfileDraft>): void {
    setDraft((current) => ({ ...current, ...changes }));
  }

  function changeRole(role: Role): void {
    setDraft((current) => ({ ...current, role }));
  }

  useProfileFeedback({
    onAvatarSaved: cancelAvatar,
    onFailed: setError,
    onSaved: cancelEdit,
  });

  return {
    avatar,
    cancelAvatar,
    cancelEdit,
    canSave: hasProfileChanges(draft, user, email) || avatar.file !== null,
    changeDraft,
    changeRole,
    draft,
    error,
    isEditing,
    setError,
    startEdit,
  };
}
