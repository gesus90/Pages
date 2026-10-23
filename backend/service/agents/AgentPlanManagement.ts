import { readAgentObject } from "@/backend/agents/AgentPayload";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { emptyAgentPlan } from "@/definition/AgentPlan";

import {
  fingerprintOperation,
  OperationRecorder,
  StoredOperationFound,
} from "./AgentOperationRecorder";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { AgentPlanExecutionTarget } from "@/definition/AgentPlanExecution";
import type { AgentPlanCloneInput } from "./AgentPlanClone";
import type { AgentPlanService } from "./AgentPlanService";

/** What the plan page sends to create a plan: its name and context, no graph. */
export interface AgentPlanCreation {
  readonly name: string;
  readonly workspaceId: string;
  /** A remote workspace of the project the nodes run in; absent for the Pages host. */
  readonly executionTarget?: AgentPlanExecutionTarget;
}

/** Stores the plan a request concerned in the commit of the change itself. */
type PlanJournal = (
  transaction: DatabaseTransaction,
  planId: string,
) => Promise<void>;

/** A request as it was read; its fields fingerprint the key it is stored under. */
interface PlanRequest {
  readonly operation: string;
  readonly operationId: string;
  readonly [field: string]: unknown;
}

function readStoredPlanId(stored: StoredAgentOperation): string {
  const parsed: unknown = JSON.parse(stored.resultJson);
  const result = readAgentObject(parsed);
  if (typeof result.planId !== "string")
    throw new AgentError("plan_access_denied");
  return result.planId;
}

/**
 * Creates, copies and deletes plans for the plan page, each request once.
 *
 * @remarks
 * Every request carries a key the page made when the person opened the
 * dialog. The result is stored under it in the same commit as the change, so
 * a double click or a repeated request after a lost answer returns the plan
 * of the first one and never creates a second copy. All rights are those of
 * the plan service: creating needs the workspace, copying read access to the
 * source, deleting the ownership of a plan without an active run.
 */
export class AgentPlanManagement {
  private readonly database: Pick<Database, "transaction">;
  private readonly plans: Pick<AgentPlanService, "save" | "clone" | "remove">;

  public constructor(dependencies: {
    readonly database: Pick<Database, "transaction">;
    readonly plans: Pick<AgentPlanService, "save" | "clone" | "remove">;
  }) {
    this.database = dependencies.database;
    this.plans = dependencies.plans;
  }

  /**
   * Creates an empty plan with a name, a workspace and a plan target; no run starts.
   *
   * @returns The identifier of the new plan.
   */
  public async create(
    userId: string,
    input: AgentPlanCreation,
    requestKey: string,
  ): Promise<string> {
    return this.once(
      userId,
      { operation: "page.plans.create", operationId: requestKey, ...input },
      (journal) =>
        this.plans.save(
          userId,
          null,
          {
            ...emptyAgentPlan(),
            // The workspace decides the project of a new plan.
            projectId: undefined,
            name: input.name,
            workspaceId: input.workspaceId,
            ...(input.executionTarget?.kind === "remote"
              ? { executionTarget: input.executionTarget }
              : {}),
          },
          journal,
        ),
    );
  }

  /**
   * Copies the saved revision of a plan into a new, independent plan.
   *
   * @returns The identifier of the copy.
   */
  public async clone(
    userId: string,
    sourceId: string,
    input: AgentPlanCloneInput,
    requestKey: string,
  ): Promise<string> {
    return this.once(
      userId,
      {
        operation: "page.plans.clone",
        operationId: requestKey,
        sourceId,
        ...input,
      },
      async (journal) => {
        try {
          return await this.plans.clone(userId, sourceId, input, journal);
        } catch (error: unknown) {
          // A stored graph the copy cannot reproduce is refused, never shortened.
          if (error instanceof AgentOperationError)
            throw new AgentError("plan_invalid");
          throw error;
        }
      },
    );
  }

  /**
   * Deletes a plan at the revision the person saw.
   *
   * @remarks
   * Runs, checkpoints and the files of the workspace stay; only the plan
   * goes. The owner alone deletes, never while a run of the plan is active.
   */
  public async remove(
    userId: string,
    planId: string,
    input: { readonly revision: number; readonly requestKey: string },
  ): Promise<void> {
    await this.once(
      userId,
      {
        operation: "page.plans.delete",
        operationId: input.requestKey,
        planId,
        revision: input.revision,
      },
      async (journal) => {
        await this.plans.remove(userId, planId, {
          revision: input.revision,
          journal: (transaction) => journal(transaction, planId),
        });
        return planId;
      },
    );
  }

  private async once(
    userId: string,
    request: PlanRequest,
    apply: (journal: PlanJournal) => Promise<string>,
  ): Promise<string> {
    const stored = await this.lookup(userId, request.operationId);
    if (stored) return this.replay(request, stored);
    const recorder = new OperationRecorder<{ readonly planId: string }>(
      userId,
      request,
    );
    try {
      return await apply((transaction, planId) =>
        recorder.store(transaction, { planId }),
      );
    } catch (error: unknown) {
      const completed =
        error instanceof StoredOperationFound
          ? error.stored
          : await this.lookup(userId, request.operationId);
      if (completed) return this.replay(request, completed);
      throw error;
    }
  }

  private async lookup(
    userId: string,
    operationId: string,
  ): Promise<StoredAgentOperation | null> {
    return this.database.transaction((transaction) =>
      new AgentOperationKeyRepository(transaction).find(userId, operationId),
    );
  }

  /** A key used for another request names no plan of this one. */
  private replay(request: PlanRequest, stored: StoredAgentOperation): string {
    if (
      stored.operation !== request.operation ||
      stored.fingerprint !== fingerprintOperation(request)
    )
      throw new AgentError("plan_invalid");
    return readStoredPlanId(stored);
  }
}
