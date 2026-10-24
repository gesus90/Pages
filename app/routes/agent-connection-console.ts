import { authenticatedUserContext } from "@/app/lib/auth.server";
import { remoteConsoleAction } from "@/app/lib/remote-console-route.server";

import type { Route } from "./+types/agent-connection-console";

/** Opens and controls only the signed-in person's host console, with current department membership. */
export async function action({
  request,
  context,
  params,
}: Route.ActionArgs): Promise<Response> {
  return remoteConsoleAction({
    request,
    user: context.get(authenticatedUserContext),
    scope: { kind: "connection", id: params.connectionId },
  });
}
