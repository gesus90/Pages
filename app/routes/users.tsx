import { useLoaderData } from "react-router";
import { useLocalStateRoute } from "@/app/components/common/use-local-state-route";
import { ManagementWorkspace } from "@/app/components/users/management-workspace";
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
import type { AdministrationPageData } from "@/definition/Authorization";
import type { AgentEmployeePageData } from "@/definition/AgentEmployeePage";
import type { WikiPrivatePagesByOwner } from "@/definition/Wiki";
import type { Route } from "./+types/users";

/** The management view with what an administrator sees of private wiki pages. */
export interface UsersPageData extends AdministrationPageData {
  readonly privateWikiPages: WikiPrivatePagesByOwner;
  readonly audience: LocalStateAudience;
  /** The agents tab (PAGE-266); `null` for an account that may not see it. */
  readonly agents: AgentEmployeePageData | null;
}

/** The rights-checked endpoint of the management view; it carries the same middleware. */
const USERS_PAGE_ENDPOINT = "/users-api/page";

function isUsersPageData(value: unknown): value is UsersPageData {
  return (
    typeof value === "object" &&
    value !== null &&
    "privateWikiPages" in value &&
    typeof value.privateWikiPages === "object" &&
    "audience" in value &&
    isLocalStateAudience(value.audience)
  );
}

/** The management view, kept per account and rights, the admin mode included. */
const USERS_PAGE_STATE: LocalStateRouteKind<UsersPageData> = {
  // 4: the agent voice (PAGE-300) joined the answer; 5: groups carry their
  // leaders (PAGE-308). An older kept answer lacks them.
  schemaVersion: 5,
  isPayload: isUsersPageData,
  isCurrent: (page) => isCurrentLocalStateAudience(page.audience),
  ownerOf: (page) => page.audience.userId,
  isRefused: () => false,
};

/**
 * Opens the management view from the account's kept answer at once and asks the endpoint behind it.
 *
 * @remarks
 * The endpoint applies the management middleware and the server loader; an
 * account without management access gets the same refusal as before.
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<UsersPageData>> {
  const url = new URL(request.url);
  return loadLocalFirst(localStateRoute(url), USERS_PAGE_STATE, () =>
    readRouteData({
      endpoint: `${USERS_PAGE_ENDPOINT}${url.search}`,
      signal: request.signal,
      isPayload: isUsersPageData,
    }),
  );
}

/** Sends a change of users, roles or departments to the API, which runs the page's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
}

/** Renders users, roles and departments in their permitted sections. */
export default function UsersRoute(): React.ReactElement {
  const page = useLocalStateRoute(
    useLoaderData<typeof clientLoader>(),
    USERS_PAGE_STATE,
  );
  return (
    <ManagementWorkspace
      directory={page}
      privateWikiPages={page.privateWikiPages}
      agents={page.agents}
    />
  );
}
