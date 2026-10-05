import { redirect } from "react-router";

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import type { Route } from "./+types/index";

/** Directs visitors to their workspace or the login screen. */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  const user = await getAuthenticatedUser(request);

  return redirect(user ? "/dashboard" : "/login");
}
