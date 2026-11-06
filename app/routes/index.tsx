import { redirect } from "react-router";

import { localState } from "@/app/lib/local-state/local-state-store";

/**
 * Directs visitors to their workspace or the login screen.
 *
 * @remarks
 * The root loader names the signed-in account from the server's answer, or
 * the account the browser keeps while the backend is down (PAGE-235).
 */
export async function clientLoader(): Promise<Response> {
  await localState.whenClaimed();
  return redirect(localState.currentOwner() ? "/dashboard" : "/login");
}
