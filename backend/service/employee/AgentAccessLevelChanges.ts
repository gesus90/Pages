import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logEvent } from "@/backend/logging/Logger";
import { enablesAgentToolGroup } from "@/definition/AgentToolGroups";

import type { UserPolicyService } from "@/backend/auth/UserPolicyService";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type { AgentToolGroup } from "@/definition/AgentToolGroups";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { AgentAccessEnvironmentService } from "./AgentAccessEnvironmentService";
import type { AgentActivityService } from "./AgentActivityService";
import type { AgentEmployeeModels } from "./AgentEmployeeModels";

/** A change of another agent's access level, based on the value last read. */
export interface AgentAccessLevelUpdate {
  readonly agentId: string;
  readonly access: AgentEmployeeAccess;
  readonly expectedAccess: AgentEmployeeAccess;
}

function actorName(actor: AccountAccess): string {
  return `${actor.firstName} ${actor.lastName}`.trim();
}

/** Guards and records changes of the access level of an agent. */
export class AgentAccessLevelChanges {
  private readonly policy: UserPolicyService;
  private readonly activity: AgentActivityService;
  private readonly accessEnvironment: AgentAccessEnvironmentService | undefined;
  private readonly models: AgentEmployeeModels;

  /** Binds the access-level rules to the channel's policy and the host's environment. */
  public constructor(
    policy: UserPolicyService,
    activity: AgentActivityService,
    accessEnvironment: AgentAccessEnvironmentService | undefined,
    models: AgentEmployeeModels,
  ) {
    this.policy = policy;
    this.activity = activity;
    this.accessEnvironment = accessEnvironment;
    this.models = models;
  }

  /**
   * Refuses a change of the access level by anyone but an administrator in
   * active admin mode, a change to the earlier "Arbeitsplatz", which is no
   * mode any more, and YOLO on a host whose service manager cannot confirm
   * the process ownership of a native session. An unchanged level needs
   * none of it, so an agent that still has "Arbeitsplatz" keeps it through
   * unrelated changes until "Lesend" or "YOLO" is chosen.
   */
  public async requireChange(
    actor: AccountAccess,
    from: AgentEmployeeAccess,
    to: AgentEmployeeAccess,
  ): Promise<void> {
    if (from === to) return;
    if (to === "workspace") throw new AgentEmployeeError("accessModeRequired");
    if (
      to === "yolo" &&
      this.policy.isManagement(actor) &&
      !this.policy.isAdministrator(actor)
    )
      throw new AgentOperationError("FORBIDDEN", { reason: "access_level" });
    if (!this.policy.hasGlobalAccess(actor))
      throw new AgentEmployeeError("accessAdminRequired");
    if (
      to === "yolo" &&
      !((await this.accessEnvironment?.isNativeHostAvailable()) ?? true)
    )
      throw new AgentEmployeeError("accessUnsupported");
  }

  /**
   * Refuses switching a tool group of an agent on again by anyone but an
   * administrator in active admin mode. Switching groups off only
   * narrows the agent and needs no more than the right to edit it.
   */
  public requireToolGroupChange(
    actor: AccountAccess,
    from: readonly AgentToolGroup[],
    to: readonly AgentToolGroup[],
  ): void {
    if (!enablesAgentToolGroup(from, to)) return;
    if (!this.policy.hasGlobalAccess(actor))
      throw new AgentEmployeeError("accessAdminRequired");
  }

  /** Records a change of the access level in the agent's activity and the server log. */
  public async record(
    store: EmployeeStore,
    change: {
      readonly agentId: string;
      readonly actor: AccountAccess;
      readonly from: AgentEmployeeAccess | null;
      readonly to: AgentEmployeeAccess;
    },
  ): Promise<void> {
    await this.activity.recordAccessChange(store, {
      agentId: change.agentId,
      from: change.from,
      to: change.to,
      actorId: change.actor.userId,
      actorName: actorName(change.actor),
    });
    logEvent({
      level: "info",
      event: "agent.access.changed",
      component: "AgentEmployeeAdministration",
      message: "Access level of an agent changed",
      metadata: {
        agentId: change.agentId,
        actorId: change.actor.userId,
        from: change.from,
        to: change.to,
      },
    });
  }

  /** Updates another agent within an authorized administration transaction. */
  public async update(
    store: EmployeeStore,
    actor: AccountAccess,
    change: AgentAccessLevelUpdate,
  ): Promise<boolean> {
    const { agentId, access, expectedAccess } = change;
    if (actor.userId === agentId || !this.policy.isAdministrator(actor))
      throw new AgentOperationError("FORBIDDEN");
    const employees = store.employees();
    const current = await employees.find(agentId);
    if (!current) throw new AgentOperationError("NOT_FOUND");
    if (current.access !== expectedAccess)
      throw new AgentOperationError("CONFLICT");
    if (current.access === access) return false;
    await this.requireChange(actor, current.access, access);
    await this.models.requireAllowed(actor.userId, { ...current, access });
    await employees.setAccessLevel(agentId, access);
    await this.record(store, {
      agentId,
      actor,
      from: current.access,
      to: access,
    });
    return true;
  }
}
