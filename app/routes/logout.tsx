import { redirect } from "react-router";

import {
  destroySessionCookie,
  getSessionToken,
} from "@/app/lib/session.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { ActionFunctionArgs } from "react-router";

/** Revokes the active session and removes its browser cookie. */
export async function action({
  request,
}: ActionFunctionArgs): Promise<Response> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const services = await getApplicationServices();
  await services.authService.logout(await getSessionToken(request));

  return redirect("/login", {
    headers: {
      "Set-Cookie": await destroySessionCookie(),
    },
  });
}
