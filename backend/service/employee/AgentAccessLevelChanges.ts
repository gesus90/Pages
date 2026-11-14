import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logEvent } from "@/backend/logging/Logger";

import type { UserPolicyService } from "@/backend/auth/UserPolicyService";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { AgentAccessEnvironmentService } from "./AgentAccessEnvironmentService";
import type { AgentActivityService } from "./AgentActivityService";

function actorName(actor: AccountAccess): string {
  return `${actor.firstName} ${actor.lastName}`.trim();
}

/** Guards and records changes of the access level of an agent (PAGE-303). */
export class AgentAccessLevelChanges {
  private readonly policy: UserPolicyService;
  private readonly activity: AgentActivityService;
  private readonly accessEnvironment: AgentAccessEnvironmentService | undefined;

  /** Binds the access-level rules to the channel's policy and the host's environment. */
  public constructor(
    policy: UserPolicyService,
    activity: AgentActivityService,
    accessEnvironment: AgentAccessEnvironmentService | undefined,
  ) {
    this.policy = policy;
    this.activity = activity;
    this.accessEnvironment = accessEnvironment;
  }

  /**
   * Refuses a change of the access level by anyone but an administrator in
   * active admin mode, and "Arbeitsplatz" on a host without the isolation
   * it runs in (PAGE-303). An unchanged level needs neither.
   */
  public async requireChange(
    actor: AccountAccess,
    from: AgentEmployeeAccess,
    to: AgentEmployeeAccess,
  ): Promise<void> {
    if (from === to) return;
    if (
      to === "yolo" &&
      this.policy.isManagement(actor) &&
      !this.policy.isAdministrator(actor)
    )
      throw new AgentOperationError("FORBIDDEN", { reason: "access_level" });
    if (!this.policy.hasGlobalAccess(actor))
      throw new AgentEmployeeError("accessAdminRequired");
    if (
      to === "workspace" &&
      !(await this.accessEnvironment?.isIsolationAvailable())
    )
      throw new AgentEmployeeError("isolationUnavailable");
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
}
