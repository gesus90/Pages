/** The only address besides the dashboard a sign-in returns to: pairing a machine, with its code (PAGE-243). */
const PAIRING_DESTINATION = /^\/koppeln(?:\?code=[A-Za-z0-9%-]{1,40})?$/u;

/**
 * Where a sign-in leads.
 *
 * @param returnTo - The address the visitor came from, untrusted.
 * @returns The pairing page with its code when that is where the visitor came from, otherwise the dashboard.
 */
export function loginDestination(returnTo?: unknown): string {
  return typeof returnTo === "string" && PAIRING_DESTINATION.test(returnTo)
    ? returnTo
    : "/dashboard";
}
