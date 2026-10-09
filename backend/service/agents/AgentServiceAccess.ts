import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import {
  AgentAccessDeniedError,
  AgentError,
} from "@/backend/error/AgentErrors";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AccountAccess } from "@/definition/Authorization";

/** Every public service operation checks persisted account facts before any work. */
export function requireAgentAdministrator(actor: AccountAccess): void {
  if (!new UserPolicyService().isAdministrator(actor))
    throw new AgentAccessDeniedError();
}

/** Resolves safe metadata after the caller has checked its actor. */
export async function requireAgentConnection(
  repository: AgentConnectionRepository,
  id: string,
): Promise<AgentConnectionRecord> {
  const connection = await repository.find(id);
  if (!connection) throw new AgentError("connection_not_found");
  return connection;
}
