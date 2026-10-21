import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";
import { runRemoteAction } from "@/app/lib/remote-actions.server";

import type { Route } from "./+types/agent-remote";

/**
 * Remote connections and remote workspace profiles of the working-directory page.
 *
 * @remarks
 * The services recheck the account, its memberships and the project rights
 * on every intent; this route only reads the form.
 */
export async function action(args: Route.ActionArgs): Promise<Response> {
  const { user, services, formData } = await readSettingsRequest(args);
  return runRemoteAction({ services, userId: user.id, formData });
}
