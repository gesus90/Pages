import { redirect } from "react-router";

import { languageCookie } from "@/app/lib/language.server";
import { resolveLocalRedirect } from "@/app/lib/redirect.server";
import { isLanguage } from "@/language/Language";
import type { Route } from "./+types/set-language";

/** Persists the language an anonymous visitor selected and returns them to their page. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const formData = await request.formData();
  const language = formData.get("language");
  const redirectTo = formData.get("redirectTo");

  if (!isLanguage(language)) {
    throw new Response("Bad Request", { status: 400 });
  }

  return redirect(resolveLocalRedirect(redirectTo), {
    headers: {
      "Set-Cookie": await languageCookie.serialize(language),
    },
  });
}
