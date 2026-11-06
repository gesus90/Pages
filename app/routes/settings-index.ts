import { redirect } from "react-router";

/** Sends `/settings` on in the browser; the personal area checks the account itself. */
export function clientLoader(): Response {
  return redirect("/settings/profile");
}
