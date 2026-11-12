import { AgentError } from "@/backend/error/AgentErrors";
import {
  AGENT_PLAN_TEAM_LIMIT,
  normalizePlanTeams,
} from "@/definition/AgentPlanTeam";

import {
  localPlanScripts,
  scriptApprovalHash,
  scriptApprovalState,
} from "./AgentPlanScriptApproval";

import type { AgentPlanAccessRepository } from "@/backend/database/repositories/agent/AgentPlanAccessRepository";
import type { AgentPlanAuditRepository } from "@/backend/database/repositories/agent/AgentPlanAuditRepository";
import type { AgentPlanScriptApprovalRepository } from "@/backend/database/repositories/agent/AgentPlanScriptApprovalRepository";
import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanView } from "@/definition/AgentPlan";
import type {
  AgentPlanAuditAction,
  AgentPlanAuditEntry,
  AgentPlanTeam,
} from "@/definition/AgentPlanTeam";
import type { AgentPlanAccess } from "./AgentPlanAccess";
import type { RunStarterDirectory } from "./diagnosis/AgentPlanRunTeamReader";

/** The most history entries one read returns. */
const HISTORY_LIMIT = 200;

/** What the team service works with. */
export interface AgentPlanTeamDependencies {
  readonly access: Pick<AgentPlanAccess, "require" | "validateTeams" | "team">;
  readonly accessChanges?: Pick<
    AgentPlanAccessRepository,
    "change" | "approveScripts" | "record"
  >;
  readonly audit?: Pick<AgentPlanAuditRepository, "list">;
  readonly approvals?: Pick<AgentPlanScriptApprovalRepository, "list">;
  readonly starters?: RunStarterDirectory;
}

/** A change of the teams and/or the owner of a plan. */
export interface AgentPlanAccessRequest {
  readonly revision: number;
  readonly teams?: readonly AgentPlanTeam[];
  readonly ownerId?: string;
  readonly journal?: (transaction: DatabaseTransaction) => Promise<void>;
}

/**
 * Teams, owner, script approvals and history of plans (PAGE-329).
 *
 * @remarks
 * The owner, active administrators and the project managers of the plan's
 * project change its teams; only an active human administrator changes the
 * owner and approves scripts. Every change is a revision of its own and is
 * recorded in the history of the plan, and so is every action of an
 * administrator on a plan of somebody else.
 */
export class AgentPlanTeamService {
  private readonly dependencies: AgentPlanTeamDependencies;

  public constructor(dependencies: AgentPlanTeamDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Changes the teams and/or the owner of a plan.
   *
   * @returns The new revision.
   * @throws {AgentError} `plan_access_denied` for a plan the person cannot
   * read, `plan_team_forbidden` without the right to change teams,
   * `plan_owner_forbidden` for an owner change by a non-administrator,
   * `plan_owner_invalid` for an inactive or unknown new owner,
   * `profile_target_invalid` for an unknown group or department,
   * `plan_conflict` for a stale revision.
   */
  public async change(
    userId: string,
    planId: string,
    request: AgentPlanAccessRequest,
  ): Promise<number> {
    const plan = await this.dependencies.access.require(userId, planId);
    const teams = request.teams && normalizePlanTeams(request.teams);
    if (teams) await this.checkTeams(plan, teams);
    if (request.ownerId !== undefined) await this.checkOwner(plan, request);
    if (plan.revision !== request.revision)
      throw new AgentError("plan_conflict");
    return this.writer().change({
      planId,
      revision: request.revision,
      actorId: userId,
      ...(teams ? { teams } : {}),
      ...(request.ownerId === undefined ? {} : { ownerId: request.ownerId }),
      journal: request.journal,
    });
  }

  /**
   * Approves the current content of every local script step of the plan.
   *
   * @returns The steps that were approved now; already approved ones are kept.
   * @throws {AgentError} `plan_script_approval_forbidden` for anybody but an
   * active human administrator, `plan_conflict` for a stale revision.
   */
  public async approveScripts(
    userId: string,
    planId: string,
    revision: number,
  ): Promise<readonly string[]> {
    const plan = await this.dependencies.access.require(userId, planId);
    if (plan.rights?.isAdministrator !== true)
      throw new AgentError("plan_script_approval_forbidden");
    if (plan.revision !== revision) throw new AgentError("plan_conflict");
    const pending = new Set(
      (await this.scriptApproval(plan)).unapprovedStepIds,
    );
    const approvals = localPlanScripts(plan)
      .filter((script) => pending.has(script.id))
      .map((script) => ({
        stepId: script.id,
        contentHash: scriptApprovalHash(plan, script),
      }));
    if (approvals.length > 0)
      await this.writer().approveScripts({
        planId,
        revision,
        actorId: userId,
        approvals,
      });
    return approvals.map((approval) => approval.stepId);
  }

  /** The approval state of the plan's scripts; without storage every script counts as unapproved. */
  public async scriptApproval(
    plan: Pick<AgentPlanView, "id" | "nodes" | "workspaceId">,
  ): Promise<ReturnType<typeof scriptApprovalState>> {
    return scriptApprovalState(
      plan,
      (await this.dependencies.approvals?.list(plan.id)) ?? new Map(),
    );
  }

  /**
   * Reads the history of a plan the person may read, newest first.
   *
   * @throws {AgentError} `plan_access_denied` for a plan the person cannot read.
   */
  public async history(
    userId: string,
    planId: string,
  ): Promise<readonly AgentPlanAuditEntry[]> {
    await this.dependencies.access.require(userId, planId);
    const entries =
      (await this.dependencies.audit?.list(planId, HISTORY_LIMIT)) ?? [];
    const names = new Map<string, string>();
    for (const entry of entries)
      if (!names.has(entry.actorId))
        names.set(
          entry.actorId,
          (await this.dependencies.starters?.displayName(entry.actorId)) ??
            entry.actorId,
        );
    return entries.map((entry) => ({
      ...entry,
      actorName: names.get(entry.actorId) ?? entry.actorId,
    }));
  }

  /**
   * Records an action of an administrator on a plan of somebody else.
   *
   * @remarks
   * Nothing is recorded for the owner or for a person whose rights do not
   * come from the administrator role alone.
   */
  public async recordAdminAction(
    userId: string,
    plan: Pick<AgentPlanView, "id" | "revision" | "rights" | "name">,
    action: AgentPlanAuditAction,
    details: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    if (plan.rights?.isAdminAccess !== true) return;
    await this.dependencies.accessChanges?.record({
      planId: plan.id,
      actorId: userId,
      action,
      revision: plan.revision,
      details: { planName: plan.name, ...details },
    });
  }

  /**
   * Records a run action of an administrator on a plan of somebody else.
   *
   * @param userId - The person who started or controlled the run.
   * @param run - The run and its plan.
   * @param action - What the person did.
   * @param details - What else the history names, such as the command.
   */
  public async recordRunAction(
    userId: string,
    run: { readonly id: string; readonly planId: string },
    action: "admin_started" | "admin_run_controlled",
    details: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    if (!this.dependencies.accessChanges) return;
    const plan = await this.dependencies.access.require(userId, run.planId);
    await this.recordAdminAction(userId, plan, action, {
      runId: run.id,
      ...details,
    });
  }

  private writer(): NonNullable<AgentPlanTeamDependencies["accessChanges"]> {
    if (!this.dependencies.accessChanges) throw new AgentError("plan_invalid");
    return this.dependencies.accessChanges;
  }

  private async checkTeams(
    plan: AgentPlanView,
    teams: readonly AgentPlanTeam[],
  ): Promise<void> {
    if (plan.rights?.canManageTeams !== true)
      throw new AgentError("plan_team_forbidden");
    if (teams.length > AGENT_PLAN_TEAM_LIMIT)
      throw new AgentError("plan_invalid");
    await this.dependencies.access.validateTeams(teams);
  }

  private async checkOwner(
    plan: AgentPlanView,
    request: AgentPlanAccessRequest,
  ): Promise<void> {
    if (plan.rights?.canChangeOwner !== true)
      throw new AgentError("plan_owner_forbidden");
    if (request.ownerId === undefined || request.ownerId === plan.ownerId)
      return;
    try {
      // An inactive or unknown account cannot own a plan.
      await this.dependencies.access.team(request.ownerId, null);
    } catch (error: unknown) {
      if (error instanceof AgentError)
        throw new AgentError("plan_owner_invalid");
      throw error;
    }
  }
}
