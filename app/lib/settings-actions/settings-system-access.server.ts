import { UserPolicyService } from "@/backend/auth/UserPolicyService";

import { forbidden } from "./settings-action-support.server";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { AccountAccess } from "@/definition/Authorization";
import type { User } from "@/definition/User";

/** What an account may do in the system settings right now. */
export type SystemSettingsAccess = "granted" | "adminModeRequired";

/**
 * Tells whether an account may reach the system settings at all.
 *
 * @param account - Current account facts.
 * @returns Whether the account holds the personal admin permission, in either mode.
 *
 * @remarks
 * Accounts in the role mode get the admin-mode notice on a direct visit, so
 * they find the way back to the admin mode.
 */
export function canSeeSystemSettings(account: AccountAccess): boolean {
  return account.isActive && account.isAdmin;
}

/**
 * Tells whether the settings navigation lists the admin areas System and Agents.
 *
 * @param account - Current account facts.
 * @returns Whether the account works in the active admin mode right now.
 *
 * @remarks
 * Following the active mode lets a mode switch show or hide both entries with
 * the next revalidation; the areas still check access on every request.
 */
export function listsAdminSettings(account: AccountAccess): boolean {
  return new UserPolicyService().isAdministrator(account);
}

/**
 * Decides how an account may use the system settings.
 *
 * @param services - Services of the request.
 * @param user - The signed-in user.
 * @returns `granted` in the admin mode, `adminModeRequired` for admins in the role mode.
 * @throws A `403` response for everyone without the admin permission.
 */
export async function resolveSystemSettingsAccess(
  services: ApplicationServices,
  user: User,
): Promise<SystemSettingsAccess> {
  const account = await services.administrationService.getContext(user.id);

  if (new UserPolicyService().isAdministrator(account)) {
    return "granted";
  }

  if (canSeeSystemSettings(account)) {
    return "adminModeRequired";
  }

  throw forbidden();
}
