import { useEffect } from "react";
import { useLoaderData, useRevalidator } from "react-router";

import { AppShell } from "@/app/components/common/app-shell";
import { ChatLauncher } from "@/app/components/chat/chat-launcher";
import { RegionProvider } from "@/app/components/common/region-provider";
import { useAuthorizationRefresh } from "@/app/components/common/use-authorization-refresh";
import { useLiveChanges } from "@/app/components/common/use-live-changes";
import {
  onLocalStateAudienceChanged,
  rememberLocalStateAudience,
} from "@/app/lib/local-state/local-state-audience";
import { isLocalStateNavigation } from "@/app/lib/local-state/local-state-navigation";
import { loadShell } from "@/app/lib/local-state/shell-loader";
import { isStorageFolderNavigation } from "@/app/lib/storage-folder-navigation";
import {
  isTaskOverlayMutation,
  isTaskOverlayNavigation,
} from "@/app/lib/task-overlay-navigation";

import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { ShellData } from "@/app/lib/shell-data";
import type { Route } from "./+types/authenticated";

/** Keeps navigation data when only a ticket overlay opens or closes, a local-state route opens or Storage changes its folder. */
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
  return isTaskOverlayNavigation(args) ||
    isTaskOverlayMutation(args) ||
    isLocalStateNavigation(args) ||
    isStorageFolderNavigation(args)
    ? false
    : args.defaultShouldRevalidate;
}

/**
 * Loads the authenticated user and their navigation permissions from the API.
 *
 * @remarks
 * The endpoint runs behind the authentication middleware; a missing or
 * ended session redirects to the sign-in page as before. Without a backend
 * the frame opens from the account's kept answer (see `loadShell`).
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<ShellData>> {
  return loadShell(request.signal);
}

/** Renders the shared workspace navigation around authenticated child routes. */
export default function AuthenticatedRoute(): React.ReactElement {
  const {
    user,
    canViewProjects,
    canViewUsers,
    authorizationVersion,
    account,
    region,
    branding,
    isPicaEnabled,
    calendarInvitations,
    localState: keptState,
  } = useLoaderData<typeof clientLoader>();
  // Kept route answers apply only to this account under these rights.
  useEffect(() => {
    rememberLocalStateAudience({ userId: user.id, authorizationVersion });
  }, [user.id, authorizationVersion]);
  // Another tab learned other rights of this account: load the shell and the page again.
  const { revalidate } = useRevalidator();
  useEffect(
    () => onLocalStateAudienceChanged(() => void revalidate()),
    [revalidate],
  );
  const isLive = useLiveChanges(authorizationVersion);
  const isOffline =
    useAuthorizationRefresh(authorizationVersion, isLive) ||
    keptState?.state === "offline";

  return (
    <RegionProvider region={region}>
      <AppShell
        branding={branding}
        canViewProjects={canViewProjects}
        canViewUsers={canViewUsers}
        user={user}
        account={account}
        isOffline={isOffline}
        calendarInvitations={calendarInvitations ?? 0}
      />
      {isPicaEnabled ? <ChatLauncher /> : null}
    </RegionProvider>
  );
}
