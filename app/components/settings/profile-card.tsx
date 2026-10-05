import { UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ProfileAvatarColumn } from "@/app/components/settings/profile-avatar-column";
import { ProfileEditForm } from "@/app/components/settings/profile-edit-form";
import { ProfileDetails } from "@/app/components/settings/profile/profile-details";
import { ProfileEditAction } from "@/app/components/settings/profile/profile-edit-action";
import { useProfileAvatarActions } from "@/app/components/settings/profile/use-profile-avatar-actions";
import { useProfileEditing } from "@/app/components/settings/profile/use-profile-editing";
import { useProfileSubmission } from "@/app/components/settings/profile/use-profile-submission";
import { SettingsCard } from "@/app/components/settings/settings-layout";
import { USER_AVATAR_TYPE } from "@/definition/User";

import type { Role } from "@/definition/Role";
import type { User } from "@/definition/User";

interface ProfileCardProps {
  readonly user: User;
  readonly email: string | null;
  readonly canEditProfile: boolean;
  readonly assignableRoles: readonly Role[];
}

/** Renders the personal profile with administrator editing and avatar upload. */
export function ProfileCard({
  user,
  email,
  canEditProfile,
  assignableRoles,
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
              assignableRoles={assignableRoles}
              error={editing.error}
              canSave={editing.canSave}
              isSubmitting={submission.isProfileSubmitting}
              onChange={editing.changeDraft}
              onRoleChange={editing.changeRole}
              onCancel={editing.cancelEdit}
              onSave={submission.saveProfile}
            />
          ) : (
            <ProfileDetails user={user} email={email} />
          )}
        </div>
      </div>
    </SettingsCard>
  );
}
