import { UserRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLoaderData, useSubmit } from "react-router";

import { ChangePasswordDialog } from "@/app/components/settings/change-password-dialog";
import { NotificationsCard } from "@/app/components/settings/notifications-card";
import { ProfileCard } from "@/app/components/settings/profile-card";
import { AccountModeCard } from "@/app/components/settings/account-mode-card";
import { RegionCard } from "@/app/components/settings/region-card";
import { RevokeOtherSessionsDialog } from "@/app/components/settings/revoke-other-sessions-dialog";
import { SecurityCard } from "@/app/components/settings/security-card";
import { SettingsSectionHeader } from "@/app/components/settings/settings-layout";
import { useUserSettings } from "@/app/components/settings/use-user-settings";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { handleSettingsAction } from "@/app/lib/settings-actions/settings-actions.server";
import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";
import { getSessionToken } from "@/app/lib/session.server";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";

import type { SettingsActionResult } from "@/app/lib/settings-actions/settings-action-support.server";
import type { SessionSummary } from "@/definition/Session";
import type { UserSettings } from "@/definition/Settings";
import type { User } from "@/definition/User";
import type { AccountAccess } from "@/definition/Authorization";
import type { Route } from "./+types/settings-profile";

interface SettingsLoaderData {
  readonly account: AccountAccess;
  readonly user: User;
  readonly email: string | null;
  readonly settings: UserSettings;
  readonly sessions: readonly SessionSummary[];
  readonly canEditProfile: boolean;
}

/** Loads the personal settings and profile context of the authenticated visitor. */
export async function loader({
  context,
  request,
}: Route.LoaderArgs): Promise<SettingsLoaderData> {
  const user = context.get(authenticatedUserContext);

  if (!user) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();
  const [settings, email, sessions] = await Promise.all([
    services.settingsService.getUserSettings(user.id),
    services.userService.findProfileEmail(user.id),
    services.sessionService.getSessionSummaries(
      user.id,
      await getSessionToken(request),
    ),
  ]);
  const account = await services.administrationService.getContext(user.id);
  const canEditProfile = new UserPolicyService().isAdministrator(account);

  return {
    account,
    canEditProfile,
    email,
    sessions,
    settings,
    user,
  };
}

/** Persists settings and manages sessions, profile edits, and passwords. */
export async function action(
  args: Route.ActionArgs,
): Promise<SettingsActionResult> {
  const settingsRequest = await readSettingsRequest(args);

  return handleSettingsAction(
    settingsRequest.formData.get("intent"),
    settingsRequest,
  );
}

/** Renders the personal settings: profile, security, notifications, and region. */
export default function SettingsProfileRoute(): React.ReactElement {
  const { t } = useTranslation();
  const {
    account,
    user,
    email,
    settings: loadedSettings,
    sessions,
    canEditProfile,
  } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const { settings, persistSettings, toggleNotification } =
    useUserSettings(loadedSettings);
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [isRevokeAllDialogOpen, setIsRevokeAllDialogOpen] = useState(false);

  function handleRevokeSession(sessionId: string): void {
    const formData = new FormData();
    formData.set("intent", "revoke-session");
    formData.set("sessionId", sessionId);
    void submit(formData, { method: "post" });
  }

  return (
    <>
      <AccountModeCard account={account} />
      <div className="w-full max-w-6xl">
        <SettingsSectionHeader
          icon={<UserRound className="size-4" aria-hidden="true" />}
          title={t("settings.personal.title")}
        />

        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <div className="flex flex-col gap-4">
            <ProfileCard
              roleName={account.role?.name ?? null}
              user={user}
              email={email}
              canEditProfile={canEditProfile}
              needsAdminMode={account.isAdmin && !canEditProfile}
            />
            <NotificationsCard
              notifications={settings.notifications}
              onToggle={toggleNotification}
            />
          </div>

          <div className="flex flex-col gap-4">
            <SecurityCard
              sessions={sessions}
              onChangePassword={() => setIsPasswordDialogOpen(true)}
              onRevokeSession={handleRevokeSession}
              onRevokeOtherSessions={() => setIsRevokeAllDialogOpen(true)}
            />
            <RegionCard settings={settings} onChange={persistSettings} />
          </div>
        </div>
      </div>

      <ChangePasswordDialog
        open={isPasswordDialogOpen}
        onOpenChange={setIsPasswordDialogOpen}
      />
      <RevokeOtherSessionsDialog
        open={isRevokeAllDialogOpen}
        onOpenChange={setIsRevokeAllDialogOpen}
      />
    </>
  );
}
