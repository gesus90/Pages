import type { AuthService } from "@/backend/auth/AuthService";
import type { User } from "@/definition/User";
import type { PicaMobileSessionIdentity } from "./PicaMobileDashboardProvider";

/**
 * Reads the account of a connection's session as it is now.
 *
 * @param authService - Resolves a session token to its account.
 * @param session - The account and session the connection authenticated with.
 * @returns The account, or `null` when the session or the account no longer
 * holds: the session ended, the account is deactivated, it has to change its
 * password, or the session belongs to another account than the connection.
 */
export async function readCurrentSessionUser(
  authService: Pick<AuthService, "getAuthenticatedUser">,
  session: PicaMobileSessionIdentity,
): Promise<User | null> {
  const user = await authService.getAuthenticatedUser(session.sessionToken);

  if (
    user === null ||
    user.id !== session.userId ||
    !user.isActive ||
    user.mustChangePassword
  ) {
    return null;
  }

  return user;
}
