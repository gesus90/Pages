import { useTranslation } from "react-i18next";

import { ProfileRow } from "@/app/components/settings/settings-layout";

import type { User } from "@/definition/User";

interface ProfileDetailsProps {
  readonly roleName?: string | null;
  readonly user: User;
  readonly email: string | null;
}

/** The read-only profile values of someone who may not edit them. */
export function ProfileDetails({
  roleName,
  user,
  email,
}: ProfileDetailsProps): React.ReactElement {
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
