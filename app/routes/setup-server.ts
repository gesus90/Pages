import { handleSetupAction } from "@/app/lib/setup/setup-actions.server";
import { SETUP_FORM_FIELD } from "@/app/lib/setup/setup-action-data";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";

import type { SetupLoaderData } from "@/app/lib/setup/setup-action-data";
import type { SetupActionResult } from "@/app/lib/setup/setup-actions.server";
import type { Route } from "./+types/setup-server";

/**
 * Tells the wizard whether the setup is pending and whether the setup link
 * carried a valid token.
 *
 * @remarks
 * After the setup finished, the page only offers the way to sign in. The
 * endpoint `/app-api/setup` answers with it (PAGE-235).
 */
export async function loader({
  request,
}: Route.LoaderArgs): Promise<SetupLoaderData> {
  const runtime = await getPagesRuntime();

  if (!runtime.isSetupPending()) {
    return { status: "completed" };
  }

  const token = new URL(request.url).searchParams.get(SETUP_FORM_FIELD.TOKEN);

  if (token !== null && runtime.verifySetupToken(token)) {
    return {
      access: {
        suggestedDatabaseUrl: "",
        token,
      },
      hasRejectedToken: false,
      status: "pending",
    };
  }

  return { access: null, hasRejectedToken: token !== null, status: "pending" };
}

/** Checks the token or the database connection, or finishes the setup. */
export async function action({
  request,
}: Route.ActionArgs): Promise<SetupActionResult> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  return handleSetupAction(await getPagesRuntime(), request);
}
