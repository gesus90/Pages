import { redirect } from "react-router";

/** Sends `/settings` to the personal area, which every account can open. */
export function loader(): Response {
  return redirect("/settings/profile");
}
