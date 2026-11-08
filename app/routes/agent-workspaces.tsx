import { useLoaderData } from "react-router";

import { WorkspaceLoadError } from "@/app/components/agents/workspaces/workspace-load-error";
import { WorkspacePage } from "@/app/components/agents/workspaces/workspace-page";
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

import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { LocalStateRouteKind } from "@/app/components/common/use-local-state-route";
import type { LocalStateAudience } from "@/app/lib/local-state/local-state-audience";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { AgentWorkspacePage } from "@/definition/AgentWorkspace";
import type { RemoteOverview } from "@/definition/RemoteConnection";
import type { Route } from "./+types/agent-workspaces";

const REMOTE_ACTION = "/agents/workspaces/remote";

/** Local registrations and the remote connections and profiles of one page. */
export interface WorkspaceOverview {
  readonly page: AgentWorkspacePage;
  readonly remote: RemoteOverview;
  readonly audience: LocalStateAudience;
}

/** The rights-checked endpoint of the workspace directory. */
const WORKSPACE_PAGE_ENDPOINT = "/agent-api/workspace-page";

function isWorkspaceOverview(value: unknown): value is WorkspaceOverview {
  return (
    typeof value === "object" &&
    value !== null &&
    "page" in value &&
    typeof value.page === "object" &&
    value.page !== null &&
    "remote" in value &&
    typeof value.remote === "object" &&
    value.remote !== null &&
    "audience" in value &&
    isLocalStateAudience(value.audience)
  );
}

/** The workspace directory, kept per account and rights. */
const WORKSPACE_PAGE_STATE: LocalStateRouteKind<WorkspaceOverview> = {
  schemaVersion: 1,
  isPayload: isWorkspaceOverview,
  isCurrent: (overview) => isCurrentLocalStateAudience(overview.audience),
  ownerOf: (overview) => overview.audience.userId,
  isRefused: () => false,
};

/**
 * Opens the directory from the account's kept answer at once and asks the endpoint behind it.
 *
 * @remarks
 * The endpoint runs the server loader with its checks; a failed load shows
 * the same error as before.
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<WorkspaceOverview>> {
  const url = new URL(request.url);
  return loadLocalFirst(localStateRoute(url), WORKSPACE_PAGE_STATE, () =>
    readRouteData({
      endpoint: `${WORKSPACE_PAGE_ENDPOINT}${url.search}`,
      signal: request.signal,
      isPayload: isWorkspaceOverview,
    }),
  );
}

/** Sends a change of a workspace registration to the API, which runs the page's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
}

/**
 * Reloads the page after every remote action, a refused one included.
 *
 * @remarks
 * A refused check can still have stored a new result or started a series,
 * but React Router skips the reload after a 4xx answer; the row would keep
 * its old state next to the message until the next poll.
 */
export function shouldRevalidate({
  formAction,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  return formAction === REMOTE_ACTION || defaultShouldRevalidate;
}

/** Shares the existing Pages cards and dialogs with the central agent administration. */
export default function AgentWorkspacesRoute(): React.ReactElement {
  const { page, remote } = useLocalStateRoute(
    useLoaderData<typeof clientLoader>(),
    WORKSPACE_PAGE_STATE,
  );
  return <WorkspacePage page={page} remote={remote} />;
}

/** A failed load keeps the page chrome and offers a retry. */
export function ErrorBoundary(): React.ReactElement {
  return <WorkspaceLoadError />;
}
