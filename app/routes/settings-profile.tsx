import { UserRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLoaderData, useSubmit } from "react-router";

import { ChangePasswordDialog } from "@/app/components/settings/change-password-dialog";
import { NotificationsCard } from "@/app/components/settings/notifications-card";
import { ProfileCard } from "@/app/components/settings/profile-card";
import { AccountModeCard } from "@/app/components/settings/account-mode-card";
import { AppearanceCard } from "@/app/components/settings/appearance-card";
import { RegionCard } from "@/app/components/settings/region-card";
import { RevokeOtherSessionsDialog } from "@/app/components/settings/revoke-other-sessions-dialog";
import { SecurityCard } from "@/app/components/settings/security-card";
import { TerminalCard } from "@/app/components/settings/terminal-card";
import { SettingsSectionHeader } from "@/app/components/settings/settings-layout";
import { useUserSettings } from "@/app/components/settings/use-user-settings";
import { useLocalStateRoute } from "@/app/components/common/use-local-state-route";
import {
  isCurrentLocalStateAudience,
  isLocalStateAudience,
} from "@/app/lib/local-state/local-state-audience";
import {
  loadLocalFirst,
  localStateRoute,
} from "@/app/lib/local-state/local-state-loader";
import { readRouteData } from "@/app/lib/local-state/route-data";
import { sendToBackend } from "@/app/lib/backend-request";

import type { LocalStateRouteKind } from "@/app/components/common/use-local-state-route";
import type { LocalStateAudience } from "@/app/lib/local-state/local-state-audience";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { DesignThemeSelection } from "@/definition/DesignTheme";
import type { SessionSummary } from "@/definition/Session";
import type {
  TerminalScreenReaderMode,
  UserSettings,
} from "@/definition/Settings";
import type { User } from "@/definition/User";
import type { AccountAccess } from "@/definition/Authorization";
import type { Route } from "./+types/settings-profile";

/** The personal settings as the endpoint answers them. */
export interface SettingsLoaderData {
  readonly account: AccountAccess;
  readonly user: User;
  readonly email: string | null;
  readonly settings: UserSettings;
  /** How the remote console offers its screen to a screen reader. */
  readonly terminalScreenReader: TerminalScreenReaderMode;
  /** The installed design themes, read from the theme directory on every load. */
  readonly designThemes: DesignThemeSelection;
  readonly sessions: readonly SessionSummary[];
  readonly canEditProfile: boolean;
  readonly audience: LocalStateAudience;
}

/** The rights-checked endpoint of the personal settings. */
const SETTINGS_PROFILE_ENDPOINT = "/settings-api/profile";

function isSettingsLoaderData(value: unknown): value is SettingsLoaderData {
  return (
    typeof value === "object" &&
    value !== null &&
    "account" in value &&
    typeof value.account === "object" &&
    "user" in value &&
    typeof value.user === "object" &&
    "settings" in value &&
    typeof value.settings === "object" &&
    "sessions" in value &&
    Array.isArray(value.sessions) &&
    "designThemes" in value &&
    typeof value.designThemes === "object" &&
    "audience" in value &&
    isLocalStateAudience(value.audience)
  );
}

/** The personal settings, kept per account and rights. */
const SETTINGS_PROFILE_STATE: LocalStateRouteKind<SettingsLoaderData> = {
  schemaVersion: 1,
  isPayload: isSettingsLoaderData,
  isCurrent: (profile) => isCurrentLocalStateAudience(profile.audience),
  ownerOf: (profile) => profile.audience.userId,
  isRefused: () => false,
};

/**
 * Opens the personal settings from the account's kept answer at once and asks the endpoint behind it.
 *
 * @remarks
 * The endpoint runs the server loader for the signed-in session.
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<SettingsLoaderData>> {
  const url = new URL(request.url);
  return loadLocalFirst(localStateRoute(url), SETTINGS_PROFILE_STATE, () =>
    readRouteData({
      endpoint: `${SETTINGS_PROFILE_ENDPOINT}${url.search}`,
      signal: request.signal,
      isPayload: isSettingsLoaderData,
    }),
  );
}

/** Sends a change of the personal settings to the API, which runs the page's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
}

/** Renders the personal settings: profile, security, notifications, appearance, and region. */
export default function SettingsProfileRoute(): React.ReactElement {
  const { t } = useTranslation();
  const {
    account,
    user,
    email,
    settings: loadedSettings,
    terminalScreenReader,
    designThemes,
    sessions,
    canEditProfile,
  } = useLocalStateRoute(
    useLoaderData<typeof clientLoader>(),
    SETTINGS_PROFILE_STATE,
  );
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
            <AppearanceCard
              designThemes={designThemes}
              settings={settings}
              onChange={persistSettings}
            />
            <RegionCard settings={settings} onChange={persistSettings} />
            <TerminalCard screenReader={terminalScreenReader} />
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
