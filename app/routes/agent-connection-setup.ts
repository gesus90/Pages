import { authenticatedUserContext } from "@/app/lib/auth.server";
import { remoteConsoleAction } from "@/app/lib/remote-console-route.server";

import type { Route } from "./+types/agent-connection-setup";

/** Opens and controls only the signed-in person's runner setup; the service holds it to the setup rules. */
export async function action({
  request,
  context,
  params,
}: Route.ActionArgs): Promise<Response> {
  return remoteConsoleAction({
    request,
    user: context.get(authenticatedUserContext),
    scope: { kind: "setup", id: params.connectionId },
  });
}
