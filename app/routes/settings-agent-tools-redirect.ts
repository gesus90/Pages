import { redirect } from "react-router";

/**
 * Sends the former address of the agent tools below the agents area on to the Tools area.
 * @remarks
 * Saved links and bookmarks keep working; the Tools area checks the
 * administrator rights itself on every request.
 */
export function clientLoader(): Response {
  return redirect("/settings/tools");
}
