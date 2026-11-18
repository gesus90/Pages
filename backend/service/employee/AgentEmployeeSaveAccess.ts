import { accountForChannel } from "@/backend/auth/McpActorContext";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { CAPABILITY } from "@/definition/Authorization";

import { activeAccount, requireAdministration } from "../AdministrationAccess";
import { requireManagementTarget } from "../management/ManagementPolicy";
import {
  requireAgentAccount,
  requireDepartments,
  requireRole,
  sameDepartments,
} from "./AgentEmployeeRules";

import type { ActorChannel } from "@/backend/auth/McpActorContext";
import type { UserPolicyService } from "@/backend/auth/UserPolicyService";
import type {
  AuthorizationRepository,
  AuthorizationSnapshot,
} from "@/backend/database/repositories/AuthorizationRepository";
import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { AccountAccess, UserRole } from "@/definition/Authorization";
import type { AgentAccessLevelChanges } from "./AgentAccessLevelChanges";
import type { AgentEmployeeInput } from "./AgentEmployeeInput";
import type { AgentEmployeeModels } from "./AgentEmployeeModels";

interface AgentUpdateAccess {
  readonly actor: AccountAccess;
  readonly target: AccountAccess;
  readonly role: UserRole;
  readonly previous: StoredAgentEmployee;
}

/** Authorizes an agent panel save against the state in its write transaction. */
export class AgentEmployeeSaveAccess {
  private readonly channel: ActorChannel;
  private readonly policy: UserPolicyService;
  private readonly levels: AgentAccessLevelChanges;
  private readonly models: AgentEmployeeModels;

  public constructor(
    channel: ActorChannel,
    policy: UserPolicyService,
    levels: AgentAccessLevelChanges,
    models: AgentEmployeeModels,
  ) {
    this.channel = channel;
    this.policy = policy;
    this.levels = levels;
    this.models = models;
  }

  /** Checks a grant change against persisted human admin mode before adapting the actor's channel. */
  public actor(
    snapshot: AuthorizationSnapshot,
    actorId: string,
    input: AgentEmployeeInput,
  ): AccountAccess {
    const account = activeAccount(snapshot, actorId);
    if (input.hasAdministratorRights !== undefined)
      requireAdministration(
        this.policy.isHumanAdministratorInAdminMode(account),
      );
    return accountForChannel(account, this.channel);
  }

  /** Checks the target, memberships, model and access changes for an update. */
  public async requireUpdate(
    repository: AuthorizationRepository,
    actorId: string,
    agentId: string,
    input: AgentEmployeeInput,
  ): Promise<AgentUpdateAccess> {
    const snapshot = await repository.snapshot();
    const actor = this.actor(snapshot, actorId, input);
    const target = requireAgentAccount(snapshot, agentId);
    requireAdministration(
      this.policy.canChange(actor, target, CAPABILITY.MANAGE_USERS),
    );
    const role = requireRole(snapshot, input.roleId);
    if (!this.policy.isAdministrator(actor))
      requireManagementTarget(actor, target, role.id);
    if (role.id !== target.role?.id)
      requireAdministration(
        this.policy.canChange(actor, target, CAPABILITY.MANAGE_ROLES) &&
          this.policy.canAssignRole(actor, role),
      );
    if (!sameDepartments(target.departments, input.departments)) {
      requireDepartments(snapshot, input.departments);
      requireAdministration(
        this.policy.canSetMemberships(actor, target, input.departments),
      );
    }
    const previous = await repository.employees().employees().find(agentId);
    if (!previous) throw new AgentEmployeeError("notFound");
    const { settings } = input;
    if (
      input.hasAdministratorRights !== undefined &&
      (settings.connectionId !== previous.connectionId ||
        settings.model !== previous.model ||
        settings.reasoningEffort !== previous.reasoningEffort ||
        settings.access !== previous.access)
    )
      await this.models.requireAllowed(actorId, settings);
    await this.levels.requireChange(actor, previous.access, settings.access);
    this.levels.requireToolGroupChange(
      actor,
      previous.disabledToolGroups,
      settings.disabledToolGroups,
    );
    return { actor, target, role, previous };
  }
}
