import { UserPolicyService } from "@/backend/auth/UserPolicyService";

import type { AdministrationService } from "@/backend/service/AdministrationService";
import type { User } from "@/definition/User";

/**
 * Checks Storage against fresh persisted UI facts, without MCP role projection.
 *
 * @param administration - The ordinary UI administration service.
 * @param actor - The account authenticated by the device token.
 * @returns False for a missing, mismatched or unreadable context as well as denied rights.
 */
export async function hasMcpStorageAccess(
  administration: Pick<AdministrationService, "getContext">,
  actor: User,
): Promise<boolean> {
  try {
    const account = await administration.getContext(actor.id);
    return (
      account !== null &&
      account !== undefined &&
      account.userId === actor.id &&
      new UserPolicyService("ui").isAdministrator(account)
    );
  } catch {
    // Failure to establish current rights must never become a channel exception.
    return false;
  }
}
