import { redirect } from "react-router";

import { getAuthenticatedUser } from "@/app/lib/auth.server";

import type { LoaderFunctionArgs } from "react-router";

/** Directs visitors to their workspace or the login screen. */
export async function loader({
  request,
}: LoaderFunctionArgs): Promise<Response> {
  const user = await getAuthenticatedUser(request);

  return redirect(user ? "/dashboard" : "/login");
}
