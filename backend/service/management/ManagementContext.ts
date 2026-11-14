import type { PasswordHasher } from "@/backend/auth/PasswordHasher";
import type { ActorChannel } from "@/backend/auth/McpActorContext";
import type { ServerCache } from "@/backend/cache/ServerCache";
import type { Database } from "@/backend/database/Database";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { AgentEmployeeAdministration } from "@/backend/service/employee/AgentEmployeeAdministration";
import type { AccountAccess } from "@/definition/Authorization";
import type { AccountInvitationDelivery } from "@/definition/Management";

/** Only the database operations the administration actually uses. */
export type ManagementDatabase = Pick<
  Database,
  "query" | "execute" | "transaction" | "readTransaction" | "runCall"
>;
/** Agent administration is an interchangeable boundary with the UI's public methods. */
export interface ManagementAgents extends Pick<
  AgentEmployeeAdministration,
  "create" | "detail" | "update" | "setActive"
> {
  /** Selects the server-owned administrator interpretation of a surface. */
  forChannel(channel: ActorChannel): ManagementAgents;
}
/** Server-owned dependencies of the shared business administration boundary. */
export interface ManagementDependencies {
  readonly database: ManagementDatabase;
  readonly cache: ServerCache;
  readonly hasher: PasswordHasher;
  readonly agents: ManagementAgents;
  readonly invitations: AccountInvitationDelivery;
}
/** One current actor and the aggregate participating in its call transaction. */
export interface ManagementContext extends ManagementDependencies {
  readonly authorization: AuthorizationRepository;
  readonly actor: AccountAccess;
  readonly channel: ActorChannel;
}
