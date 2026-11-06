import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as agentWorkspacesLoader } from "./agent-workspaces-server";

/** Answers the workspace directory with the checks of its route: only accessible projects and connections. */
export async function loader(
  args: Parameters<typeof agentWorkspacesLoader>[0],
): Promise<Response> {
  return routeDataResponse(await agentWorkspacesLoader(args));
}
