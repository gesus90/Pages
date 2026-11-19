import { Pencil, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher, useNavigation, useSubmit } from "react-router";

import { PersonColorPicker } from "@/app/components/common/person-color-picker";
import { ProfileAvatarColumn } from "@/app/components/settings/profile-avatar-column";
import { ProfileEditForm } from "@/app/components/settings/profile-edit-form";
import {
  ProfileRow,
  SettingsCard,
} from "@/app/components/settings/settings-layout";
import { useActionOutcome } from "@/app/components/settings/use-action-outcome";
import { Button } from "@/app/components/ui/button";
import {
  EMAIL_PATTERN,
  MAXIMUM_AVATAR_BYTES,
  SUPPORTED_AVATAR_MIME_TYPES,
  USER_AVATAR_TYPE,
} from "@/definition/User";

import type { ProfileDraft } from "@/app/components/settings/profile-edit-form";
import type { SettingsActionData } from "@/app/lib/settings-actions/settings-action-support.server";
import type { PersonColor } from "@/definition/PersonColor";
import type { Role } from "@/definition/Role";
import type { User } from "@/definition/User";
import type { ChangeEvent } from "react";

interface ProfileCardProps {
  readonly roleName?: string | null;
  readonly user: User;
  readonly email: string | null;
  readonly canEditProfile: boolean;
  /** Whether the account may edit the profile after switching to the admin mode. */
  readonly needsAdminMode?: boolean;
}

interface ProfileInput {
  readonly displayName: string;
  readonly username: string;
  readonly email: string;
  readonly role: Role;
}

interface AvatarSelection {
  readonly file: File | null;
  readonly previewUrl: string | null;
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly select: (file: File) => void;
  readonly clear: () => void;
}

interface ProfileFeedback {
  readonly onSaved: () => void;
  readonly onAvatarSaved: () => void;
  readonly onFailed: (message: string) => void;
}

interface ProfileEditing {
  readonly avatar: AvatarSelection;
  readonly isEditing: boolean;
  readonly draft: ProfileDraft;
  readonly error: string | null;
  readonly canSave: boolean;
  readonly setError: (message: string | null) => void;
  readonly startEdit: () => void;
  readonly cancelEdit: () => void;
  readonly cancelAvatar: () => void;
  readonly changeDraft: (changes: Partial<ProfileDraft>) => void;
}

interface ProfileAvatarActions {
  readonly handleAvatarClick: () => void;
  readonly handleAvatarFileChange: (
    event: ChangeEvent<HTMLInputElement>,
  ) => void;
}

interface ProfileSubmission {
  readonly isProfileSubmitting: boolean;
  readonly isAvatarSubmitting: boolean;
  readonly saveProfile: () => void;
  readonly saveAvatar: (() => void) | undefined;
}

function cleanUsername(username: string): string {
  return (username.startsWith("@") ? username.slice(1) : username).trim();
}

function createProfileDraft(user: User, email: string | null): ProfileDraft {
  return {
    displayName: user.displayName,
    email: email ?? "",
    role: user.role,
    username: `@${user.username}`,
  };
}

function hasProfileChanges(
  draft: ProfileDraft,
  user: User,
  email: string | null,
): boolean {
  return (
    draft.displayName.trim() !== user.displayName.trim() ||
    cleanUsername(draft.username) !== user.username.trim() ||
    draft.email.trim() !== (email ?? "").trim() ||
    draft.role !== user.role
  );
}

function parseProfileDraft(draft: ProfileDraft): ProfileInput | null {
  const displayName = draft.displayName.trim();
  const username = cleanUsername(draft.username);
  const email = draft.email.trim();

  if (!displayName || !username) {
    return null;
  }

  if (email && !EMAIL_PATTERN.test(email)) {
    return null;
  }

  return { displayName, email, role: draft.role, username };
}

function createProfileFormData(
  input: ProfileInput,
  avatar: File | null,
): FormData {
  const formData = new FormData();

  formData.set("intent", "update-profile");
  formData.set("displayName", input.displayName);
  formData.set("username", input.username);
  formData.set("email", input.email);
  formData.set("role", input.role);

  if (avatar) {
    formData.set("avatar", avatar);
  }

  return formData;
}

function createAvatarFormData(avatar: File): FormData {
  const formData = new FormData();

  formData.set("intent", "update-avatar");
  formData.set("avatar", avatar);

  return formData;
}

function isAcceptableAvatarFile(file: File): boolean {
  return (
    SUPPORTED_AVATAR_MIME_TYPES.has(file.type) &&
    file.size <= MAXIMUM_AVATAR_BYTES
  );
}

function useAvatarSelection(): AvatarSelection {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function releasePreview(): void {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
  }

  function select(nextFile: File): void {
    releasePreview();
    setFile(nextFile);
    setPreviewUrl(URL.createObjectURL(nextFile));
  }

  function clear(): void {
    releasePreview();
    setFile(null);
    setPreviewUrl(null);
  }

  return { clear, file, inputRef, previewUrl, select };
}

function useProfileFeedback(feedback: ProfileFeedback): void {
  const { t } = useTranslation();
  const profileOutcome = useActionOutcome("update-profile");
  const avatarOutcome = useActionOutcome("update-avatar");
  const lastProfileOutcome = useRef<SettingsActionData | null>(null);
  const lastAvatarOutcome = useRef<SettingsActionData | null>(null);

  useEffect(() => {
    if (!profileOutcome || profileOutcome === lastProfileOutcome.current) {
      return;
    }

    lastProfileOutcome.current = profileOutcome;

    if (profileOutcome.ok) {
      feedback.onSaved();
    } else {
      feedback.onFailed(t(`settings.profile.errors.${profileOutcome.error}`));
    }
  }, [profileOutcome, feedback, t]);

  useEffect(() => {
    if (!avatarOutcome || avatarOutcome === lastAvatarOutcome.current) {
      return;
    }

    lastAvatarOutcome.current = avatarOutcome;

    if (avatarOutcome.ok) {
      feedback.onAvatarSaved();
    } else {
      feedback.onFailed(t(`settings.profile.errors.${avatarOutcome.error}`));
    }
  }, [avatarOutcome, feedback, t]);
}

function useProfileEditing({
  user,
  email,
}: {
  readonly user: User;
  readonly email: string | null;
}): ProfileEditing {
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
    draft,
    error,
    isEditing,
    setError,
    startEdit,
  };
}

function useProfileAvatarActions({
  canEditProfile,
  editing,
}: {
  readonly canEditProfile: boolean;
  readonly editing: ProfileEditing;
}): ProfileAvatarActions {
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

function useProfileSubmission(editing: ProfileEditing): ProfileSubmission {
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

function ProfileEditAction({
  isEditing,
  onEdit,
}: {
  readonly isEditing: boolean;
  readonly onEdit: () => void;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Button
      className="h-8 gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-primary shadow-xs hover:bg-surface-hover hover:text-primary-hover disabled:opacity-50"
      disabled={isEditing}
      onClick={onEdit}
      type="button"
      variant="outline"
    >
      <Pencil className="size-3.5 text-primary" aria-hidden="true" />
      {t("settings.profile.editAction")}
    </Button>
  );
}

function ProfileDetails({
  roleName,
  user,
  email,
}: {
  readonly roleName?: string | null;
  readonly user: User;
  readonly email: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const hasEmail = email !== null && email !== "";

  return (
    <dl className="flex flex-col gap-4">
      <ProfileRow label={t("settings.profile.displayName")}>
        {user.displayName}
      </ProfileRow>
      <ProfileRow label={t("settings.profile.username")}>
        @{user.username}
      </ProfileRow>
      <ProfileRow label={t("settings.profile.email")}>
        {hasEmail ? (
          email
        ) : (
          <span className="text-muted-foreground">
            {t("settings.profile.notProvided")}
          </span>
        )}
      </ProfileRow>
      <ProfileRow label={t("settings.profile.position")}>
        {roleName === undefined ? t(`role.${user.role}`) : (roleName ?? "—")}
      </ProfileRow>
    </dl>
  );
}

function ProfileColorRow({
  color,
}: {
  readonly color: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher();
  const pending = fetcher.formData?.get("color");
  const shown = typeof pending === "string" ? pending || null : color;

  function handleChange(next: PersonColor | null): void {
    const formData = new FormData();
    formData.set("intent", "update-color");
    formData.set("color", next ?? "");
    void fetcher.submit(formData, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <span className="text-sm text-muted-foreground">
        {t("settings.profile.color")}
      </span>
      <PersonColorPicker
        value={shown}
        onChange={handleChange}
        label={t("settings.profile.color")}
        isDisabled={fetcher.state !== "idle"}
        canClear
      />
    </div>
  );
}

/** Renders the personal profile with administrator editing and avatar upload. */
export function ProfileCard({
  roleName,
  user,
  email,
  canEditProfile,
  needsAdminMode = false,
}: ProfileCardProps): React.ReactElement {
  const { t } = useTranslation();
  const editing = useProfileEditing({ email, user });
  const avatarActions = useProfileAvatarActions({ canEditProfile, editing });
  const submission = useProfileSubmission(editing);
  const { previewUrl } = editing.avatar;
  const displayUser = previewUrl
    ? {
        ...user,
        avatarImageUrl: previewUrl,
        avatarType: USER_AVATAR_TYPE.IMAGE,
      }
    : user;

  return (
    <SettingsCard
      action={
        // Ordinary users never see an edit action here; their profile text is
        // administratively managed.
        canEditProfile ? (
          <ProfileEditAction
            isEditing={editing.isEditing}
            onEdit={editing.startEdit}
          />
        ) : undefined
      }
      description={t("settings.profile.description")}
      icon={<UserRound className="size-4" aria-hidden="true" />}
      title={t("settings.profile.title")}
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8 xl:gap-10">
        <ProfileAvatarColumn
          user={displayUser}
          canEditProfile={canEditProfile}
          isEditingProfile={editing.isEditing}
          isAvatarSubmitting={submission.isAvatarSubmitting}
          error={editing.error}
          inputRef={editing.avatar.inputRef}
          onFileChange={avatarActions.handleAvatarFileChange}
          onAvatarClick={avatarActions.handleAvatarClick}
          onCancelAvatar={editing.cancelAvatar}
          onSaveAvatar={submission.saveAvatar}
        />

        <div className="min-w-0 flex-1">
          {canEditProfile && editing.isEditing ? (
            <ProfileEditForm
              draft={editing.draft}
              error={editing.error}
              canSave={editing.canSave}
              isSubmitting={submission.isProfileSubmitting}
              onChange={editing.changeDraft}
              onCancel={editing.cancelEdit}
              onSave={submission.saveProfile}
            />
          ) : (
            <ProfileDetails user={user} email={email} roleName={roleName} />
          )}
          <div className="mt-4">
            <ProfileColorRow color={user.avatarColor ?? null} />
          </div>
          {needsAdminMode ? (
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              {t("settings.profile.adminModeHint")}
            </p>
          ) : null}
        </div>
      </div>
    </SettingsCard>
  );
}
