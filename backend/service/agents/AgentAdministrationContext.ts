import type { AgentChannel } from "@/backend/auth/McpActorContext";
import type { DatabaseTransaction } from "@/backend/database/Database";
import type {
  AuthorizationRepository,
  AuthorizationSnapshot,
} from "@/backend/database/repositories/AuthorizationRepository";
import type { AdministrationService } from "@/backend/service/AdministrationService";
import type { GroupAdministrationService } from "@/backend/service/GroupAdministrationService";
import type { User } from "@/definition/User";

/** Fresh, administrator-authorized facts and UI services inside one locked agent transaction. */
export interface AgentAdministrationContext {
  readonly database: DatabaseTransaction;
  readonly repository: AuthorizationRepository;
  readonly snapshot: AuthorizationSnapshot;
  readonly administration: AdministrationService;
  readonly groups: GroupAdministrationService;
  readonly actor: User;
  readonly channel: AgentChannel;
}
