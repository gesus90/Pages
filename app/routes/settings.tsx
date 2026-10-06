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
import { SystemSection } from "@/app/components/settings/system-section";
import { useUserSettings } from "@/app/components/settings/use-user-settings";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { handleSettingsAction } from "@/app/lib/settings-actions/settings-actions.server";
import { createServerSettingsService } from "@/app/lib/settings-actions/settings-system-actions.server";
import { getSessionToken } from "@/app/lib/session.server";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";

import type { SettingsActionResult } from "@/app/lib/settings-actions/settings-action-support.server";
import type { SessionSummary } from "@/definition/Session";
import type { UserSettings } from "@/definition/Settings";
import type { User } from "@/definition/User";
import type { AccountAccess } from "@/definition/Authorization";
import type { Route } from "./+types/settings";

interface SettingsLoaderData {
  readonly account: AccountAccess;
  readonly user: User;
  readonly email: string | null;
  readonly settings: UserSettings;
  readonly sessions: readonly SessionSummary[];
  readonly canEditProfile: boolean;
  /** Port stored for the next start, only for users who may change it. */
  readonly serverPort: number | null;
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
  const serverSettings = await createServerSettingsService({ services });

  return {
    account,
    canEditProfile,
    email,
    serverPort: (await serverSettings.canManage(user))
      ? await serverSettings.readPort()
      : null,
    sessions,
    settings,
    user,
  };
}

/** Persists settings and manages sessions, profile edits, and passwords. */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<SettingsActionResult> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const user = context.get(authenticatedUserContext);

  if (!user) {
    throw new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();

  return handleSettingsAction(formData.get("intent"), {
    formData,
    request,
    services: await getApplicationServices(),
    user,
  });
}

/** Renders the modular, scroll-aware Pages settings screen. */
export default function SettingsRoute(): React.ReactElement {
  const { t } = useTranslation();
  const {
    account,
    user,
    email,
    settings: loadedSettings,
    sessions,
    canEditProfile,
    serverPort,
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
    <section className="pages-page-fill mx-auto flex w-full max-w-6xl flex-col">
      <h1 className="shrink-0 text-2xl font-semibold tracking-tight text-foreground">
        {t("settings.title")}
      </h1>

      <VerticalScrollArea
        className="mt-6 min-h-0 flex-1"
        contentClassName="pr-4 sm:pr-6 md:pr-8 xl:pr-12 pb-12"
        fadeClassName="z-20"
      >
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

          {serverPort === null ? null : <SystemSection port={serverPort} />}
        </div>
      </VerticalScrollArea>

      <ChangePasswordDialog
        open={isPasswordDialogOpen}
        onOpenChange={setIsPasswordDialogOpen}
      />
      <RevokeOtherSessionsDialog
        open={isRevokeAllDialogOpen}
        onOpenChange={setIsRevokeAllDialogOpen}
      />
    </section>
  );
}
