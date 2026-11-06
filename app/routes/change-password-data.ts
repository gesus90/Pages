import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as changePasswordLoader } from "./change-password-server";

/**
 * Confirms that the password must be replaced, or redirects as the page's
 * loader does (PAGE-235).
 */
export async function loader(
  args: Parameters<typeof changePasswordLoader>[0],
): Promise<Response> {
  await changePasswordLoader(args);
  return routeDataResponse({ isPasswordChangeRequired: true });
}
