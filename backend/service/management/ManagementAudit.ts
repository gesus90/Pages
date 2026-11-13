import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import {
  withManagementAudit,
  managementAuditActor,
} from "@/backend/database/ManagementAuditContext";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ManagementAuditRepository } from "@/backend/database/repositories/ManagementAuditRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

import type { ManagementDatabase } from "./ManagementContext";

/** Audits all surfaces of the role and commits mutations and their audit rows together. */
export class ManagementAudit {
  private readonly database: ManagementDatabase;
  /** Uses the same database as the business services. */
  public constructor(database: ManagementDatabase) {
    this.database = database;
  }
  /** Wraps a verified request; existing roles retain their original execution path. */
  public async run<Result>(
    actorId: string,
    action: string,
    target: string,
    work: () => Promise<Result>,
  ): Promise<Result> {
    if (managementAuditActor()) return work();
    const account = (
      await new AuthorizationRepository(this.database).snapshot()
    ).accounts.find((entry) => entry.userId === actorId);
    if (!account || !new UserPolicyService().isManagement(account))
      return work();
    return withManagementAudit(actorId, () =>
      this.database.runCall(work, async ({ transaction }) => {
        await new ManagementAuditRepository(transaction).record(
          actorId,
          action,
          target,
        );
      }),
    );
  }
  /** Only administrators may inspect actor, timestamp, target and persisted before/after changes. */
  public async list(
    actorId: string,
  ): ReturnType<ManagementAuditRepository["list"]> {
    const account = (
      await new AuthorizationRepository(this.database).snapshot()
    ).accounts.find((entry) => entry.userId === actorId);
    if (!account || !new UserPolicyService().isAdministrator(account))
      throw new AgentOperationError("FORBIDDEN", { reason: "core_system" });
    return new ManagementAuditRepository(this.database).list();
  }
}
