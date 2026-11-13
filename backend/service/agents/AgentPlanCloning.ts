import { randomUUID } from "node:crypto";

import { requirePlanRevision } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentPlanAuditRepository } from "@/backend/database/repositories/agent/AgentPlanAuditRepository";
import { AgentError, isAgentErrorCode } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  normalizePlanTeams,
  planNameDepartment,
} from "@/definition/AgentPlanTeam";

import { clonePlanGraph } from "./AgentPlanClone";
import { cleanCloneForm } from "./AgentPlanCloneForm";
import { AgentPlanCloneReferences } from "./AgentPlanCloneReferences";
import { planOwnership } from "./AgentPlanOwnership";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlan, AgentPlanView } from "@/definition/AgentPlan";
import type {
  AgentPlanCloneAdjustment,
  AgentPlanCloneReceipt,
} from "@/definition/AgentPlanClone";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { PlanDependencies } from "./AgentPlanDependencies";
import type { AgentPlanCloneInput } from "./AgentPlanClone";

/** The clone receipt is recorded in the same commit as its graph and access audit. */
export type CloneJournal = (
  transaction: DatabaseTransaction,
  planId: string,
  receipt: AgentPlanCloneReceipt,
) => Promise<void>;

type CloningDependencies = Pick<
  PlanDependencies,
  | "plans"
  | "access"
  | "workspaces"
  | "workspaceCatalog"
  | "profiles"
  | "parameters"
  | "tasks"
  | "remoteTargets"
  | "remoteExecution"
  | "planAssets"
>;

function cloneFailure(error: unknown): AgentError {
  if (error instanceof AgentError) {
    if (error.code === "plan_access_denied")
      return new AgentError("source_not_visible");
    if (error.code === "plan_invalid")
      return new AgentError("clone_request_invalid");
    return error;
  }
  if (
    error instanceof AgentExecutionError &&
    error.code === "credentialsInText"
  )
    return new AgentError("credentials_in_text");
  if (error instanceof AgentOperationError) {
    if (error.code === "FORBIDDEN") return new AgentError("forbidden");
    const reason =
      error.details && "reason" in error.details
        ? error.details.reason
        : undefined;
    if (isAgentErrorCode(reason)) return new AgentError(reason);
    return new AgentError("clone_request_invalid");
  }
  return new AgentError("clone_failed");
}

/** Copies every visible source, repairing unavailable selections under the caller's rights. */
export class AgentPlanCloning {
  private readonly dependencies: CloningDependencies;

  public constructor(dependencies: CloningDependencies) {
    this.dependencies = dependencies;
  }

  /** Stores the latest source revision, automatic repairs, access and replay result atomically. */
  public async clone(
    userId: string,
    sourceId: string,
    input: AgentPlanCloneInput,
    journal?: CloneJournal,
  ): Promise<string> {
    try {
      return await this.copy(userId, sourceId, input, journal);
    } catch (error: unknown) {
      const failure = cloneFailure(error);
      console.warn("Plan clone refused", {
        planId: sourceId,
        code: failure.code,
      });
      throw failure;
    }
  }

  private async copy(
    userId: string,
    sourceId: string,
    input: AgentPlanCloneInput,
    journal?: CloneJournal,
  ): Promise<string> {
    // A changed source is retried with fresh access. No stale graph is ever committed.
    while (true) {
      const source = await this.dependencies.access.require(userId, sourceId);
      const adjustments: AgentPlanCloneAdjustment[] = [];
      if (source.revision !== input.expectedRevision)
        adjustments.push({ code: "source_revision_updated" });
      const raw = await this.dependencies.plans.cloneSource(sourceId);
      const cleaned = cleanCloneForm(raw);
      if (cleaned.wasCleaned) adjustments.push({ code: "legacy_form_cleaned" });
      const workspace = await this.workspace(userId, source, input);
      if (workspace.id !== (input.workspaceId ?? source.workspaceId))
        adjustments.push({ code: "workspace_replaced" });
      const target = await this.target(userId, { source, workspace, input });
      const proposed = clonePlanGraph(cleaned.plan, {
        ...input,
        name: input.name.trim() || `Kopie von ${source.name}`.slice(0, 120),
        workspaceId: workspace.id,
        executionTarget: target,
      });
      const repaired = await new AgentPlanCloneReferences(
        this.dependencies,
        userId,
        adjustments,
      ).prepare({ ...proposed, projectId: source.projectId });
      const plan: AgentPlan = {
        ...repaired,
        ...(await this.ownership(userId, source, input)),
        id: randomUUID(),
        projectId: source.projectId,
        revision: 1,
      };
      try {
        await this.store(userId, { source, plan, input, adjustments }, journal);
        return plan.id;
      } catch (error: unknown) {
        if (error instanceof AgentError && error.code === "plan_conflict")
          continue;
        throw error;
      }
    }
  }

  private async workspace(
    userId: string,
    source: AgentPlanView,
    input: AgentPlanCloneInput,
  ): Promise<AgentWorkspaceChoice> {
    const choices = await (this.dependencies.workspaceCatalog?.choices(
      userId,
    ) ?? this.dependencies.workspaces.choices(userId));
    const usable = choices.filter(
      (entry) =>
        entry.projectId === source.projectId && entry.isUsable !== false,
    );
    const requested = input.workspaceId ?? source.workspaceId;
    // Resolving also catches a local directory that disappeared after catalog creation.
    for (const entry of [
      ...usable.filter((choice) => choice.id === requested),
      ...usable.filter((choice) => choice.id !== requested),
    ]) {
      try {
        if (this.dependencies.workspaceCatalog)
          await this.dependencies.workspaceCatalog.resolve(userId, {
            workspaceId: entry.id,
          });
        else
          await this.dependencies.workspaces.resolve(
            userId,
            entry.id,
            source.projectId,
          );
        return entry;
      } catch (error: unknown) {
        if (!(error instanceof AgentError)) throw error;
      }
    }
    throw new AgentError("workspace_unavailable");
  }

  private async target(
    userId: string,
    context: {
      readonly source: AgentPlanView;
      readonly workspace: AgentWorkspaceChoice;
      readonly input: AgentPlanCloneInput;
    },
  ): Promise<NonNullable<AgentPlanCloneInput["executionTarget"]>> {
    const { source, workspace, input } = context;
    if (workspace.kind === "remote")
      return { kind: "remote", workspaceId: workspace.id };
    if (workspace.id !== (input.workspaceId ?? source.workspaceId))
      return { kind: "local" };
    const target = input.executionTarget ?? source.executionTarget;
    if (target?.kind !== "remote") return { kind: "local" };
    const choices = await this.dependencies.remoteTargets?.list(
      userId,
      source.projectId,
    );
    return choices?.some((entry) => entry.workspaceId === target.workspaceId)
      ? target
      : { kind: "local" };
  }

  private async ownership(
    userId: string,
    source: AgentPlanView,
    input: AgentPlanCloneInput,
  ): Promise<Awaited<ReturnType<typeof planOwnership>>> {
    if (input.ownerId !== undefined && source.rights?.isAdministrator !== true)
      throw new AgentError("forbidden");
    const ownership = await planOwnership(
      this.dependencies.access,
      userId,
      null,
    );
    if (input.ownerId !== undefined) {
      try {
        await this.dependencies.access.team(input.ownerId, null);
      } catch (error: unknown) {
        if (error instanceof AgentError)
          throw new AgentError("plan_owner_invalid");
        throw error;
      }
    }
    if (input.teams !== undefined)
      await this.dependencies.access.validateTeams(
        input.teams,
        source.projectId,
      );
    const teams =
      input.teams === undefined
        ? ownership.teams
        : normalizePlanTeams(input.teams);
    return {
      ownerId: input.ownerId ?? userId,
      departmentId:
        input.teams === undefined
          ? ownership.departmentId
          : planNameDepartment(teams),
      teams,
    };
  }

  private async store(
    userId: string,
    context: {
      readonly source: AgentPlanView;
      readonly plan: AgentPlan;
      readonly input: AgentPlanCloneInput;
      readonly adjustments: AgentPlanCloneAdjustment[];
    },
    journal?: CloneJournal,
  ): Promise<void> {
    const { source, plan, input, adjustments } = context;
    const name = plan.name.slice(0, 120);
    let suffix = 1;
    while (true) {
      const named = {
        ...plan,
        name:
          suffix === 1
            ? name
            : `${name.slice(0, 120 - String(suffix).length - 1)} ${suffix}`,
      };
      const receipt: AgentPlanCloneReceipt = {
        planId: plan.id,
        revision: 1,
        sourcePlanId: source.id,
        sourceRevision: source.revision,
        workspaceId: plan.workspaceId,
        adjustments:
          suffix === 1
            ? adjustments
            : [...adjustments, { code: "name_suffixed" }],
      };
      await this.dependencies.access.require(userId, source.id);
      try {
        await this.dependencies.plans.save(
          named,
          true,
          async (transaction) => {
            await requirePlanRevision(transaction, source.id, source.revision);
            if (input.teams !== undefined)
              await new AgentPlanAuditRepository(transaction).append({
                planId: plan.id,
                actorId: userId,
                action: "teams_changed",
                revision: 1,
                details: { teams: plan.teams },
              });
            if (input.ownerId !== undefined)
              await new AgentPlanAuditRepository(transaction).append({
                planId: plan.id,
                actorId: userId,
                action: "owner_changed",
                revision: 1,
                details: { from: userId, to: plan.ownerId },
              });
            await journal?.(transaction, plan.id, receipt);
          },
          userId,
        );
        return;
      } catch (error: unknown) {
        if (error instanceof AgentError && error.code === "plan_name_taken") {
          suffix += 1;
          continue;
        }
        throw error;
      }
    }
  }
}
