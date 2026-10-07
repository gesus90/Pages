import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";

import { forbidden } from "./settings-action-support.server";

import type { SettingsActionContext } from "./settings-action-support.server";
import type { RouterContextProvider } from "react-router";

/**
 * Checks a settings form submission and gathers what its handler needs.
 *
 * @param args - Request and route context of the action.
 * @returns User, request, form fields and services of the submission.
 * @throws A `405` response for anything but a POST and a `403` response
 * without a signed-in user.
 */
export async function readSettingsRequest({
  request,
  context,
}: {
  readonly request: Request;
  readonly context: Readonly<RouterContextProvider>;
}): Promise<SettingsActionContext> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const user = context.get(authenticatedUserContext);

  if (!user) {
    throw forbidden();
  }

  return {
    formData: await request.formData(),
    request,
    services: await getApplicationServices(),
    user,
  };
}
