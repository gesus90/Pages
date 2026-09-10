import { redirect } from "react-router";

import { languageCookie } from "@/app/lib/language.server";
import { isLanguage } from "@/language/Language";

import type { ActionFunctionArgs } from "react-router";

/** Persists the language an anonymous visitor selected and returns them to their page. */
export async function action({
  request,
}: ActionFunctionArgs): Promise<Response> {
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

  const target =
    typeof redirectTo === "string" && redirectTo.startsWith("/")
      ? redirectTo
      : "/";

  return redirect(target, {
    headers: {
      "Set-Cookie": await languageCookie.serialize(language),
    },
  });
}
