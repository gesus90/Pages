import { AgentAccessDeniedError } from "@/backend/error/AgentErrors";
import { requireAgentAdministrator } from "@/backend/service/agents/AgentServiceAccess";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { AccountAccess } from "@/definition/Authorization";
import type { User } from "@/definition/User";

/** Reads fresh account facts for each request and enforces the personal admin permission. */
export async function readAgentAccount(
  services: ApplicationServices,
  user: User | null,
): Promise<AccountAccess> {
  if (!user) throw new AgentAccessDeniedError();
  const account = await services.administrationService.getContext(user.id);
  if (!account.isActive || !account.isAdmin) throw new AgentAccessDeniedError();
  return account;
}

/** Actions and polling require the active admin mode, not just navigation visibility. */
export async function requireAgentAccount(
  services: ApplicationServices,
  user: User | null,
): Promise<AccountAccess> {
  const account = await readAgentAccount(services, user);
  requireAgentAdministrator(account);
  return account;
}
