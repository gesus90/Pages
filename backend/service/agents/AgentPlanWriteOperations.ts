import { AgentError } from "@/backend/error/AgentErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";

import {
  fingerprintOperation,
  OperationRecorder,
  StoredOperationFound,
} from "./AgentOperationRecorder";
import { readPlanWriteRequest } from "./AgentPlanOperationInput";
import { applyPlanChanges } from "./AgentPlanStructureChanges";
import { toSharing } from "./PageAgentOperationDefinition";

import type { Database } from "@/backend/database/Database";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { AgentPlanInput, AgentPlanView } from "@/definition/AgentPlan";
import type {
  AgentPlanChanged,
  AgentPlanWriteOperation,
} from "@/definition/AgentPlanOperations";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { AgentPlanService } from "./AgentPlanService";
import type {
  AgentPlanChange,
  AgentPlanCreateRequest,
  AgentPlanUpdateRequest,
  AgentPlanWriteRequest,
} from "./AgentPlanOperationInput";
import type { PageAgentSharingRequest } from "./PageAgentOperationInput";

/** The plan service functions the changes use, and the database their results are stored in. */
export interface AgentPlanWriteDependencies {
  readonly database: Pick<Database, "transaction">;
  readonly plans: Pick<AgentPlanService, "view" | "agents" | "save">;
}

/** The usage and share a plan stores for a requested share. */
function planSharing(
  request: PageAgentSharingRequest,
): Pick<AgentPlanInput, "usage" | "sharing"> {
  return {
    usage: request.scope === "private" ? "private" : "workspace",
    sharing: { operator: "or", ...toSharing(request) },
  };
}

/** The editable part of a plan, so a change that matches it writes nothing. */
function planKey(plan: AgentPlanInput): string {
  return JSON.stringify([
    plan.name,
    plan.usage,
    plan.sharing ?? null,
    plan.nodes,
    plan.edges,
  ]);
}

function editable(plan: AgentPlanView): AgentPlanInput {
  return {
    name: plan.name,
    workspaceId: plan.workspaceId,
    usage: plan.usage,
    ...(plan.sharing === undefined ? {} : { sharing: plan.sharing }),
    projectId: plan.projectId,
    globals: plan.globals,
    nodes: plan.nodes,
    edges: plan.edges,
    revision: plan.revision,
  };
}

function readStoredResult(json: string): AgentPlanChanged {
  const stored: unknown = JSON.parse(json);
  if (
    typeof stored !== "object" ||
    stored === null ||
    !("planId" in stored) ||
    typeof stored.planId !== "string" ||
    !("changed" in stored) ||
    typeof stored.changed !== "boolean" ||
    !("revision" in stored) ||
    typeof stored.revision !== "number" ||
    !("createdNodeIds" in stored) ||
    !Array.isArray(stored.createdNodeIds)
  )
    throw new AgentOperationError("CONFLICT");
  return {
    planId: stored.planId,
    changed: stored.changed,
    revision: stored.revision,
    createdNodeIds: stored.createdNodeIds.filter(
      (id): id is string => typeof id === "string",
    ),
  };
}

function needsAgents(changes: readonly AgentPlanChange[]): boolean {
  return changes.some(
    (change) => change.action === "addNode" && change.type === "agent",
  );
}

/**
 * Creates plans and changes their structure, share and parameters for their owner.
 *
 * @remarks
 * Every change is saved by the plan service exactly like the plan page saves
 * it: only the owner changes a plan, against the revision read last, and the
 * graph, the agents, tickets and references are checked on save. A change is
 * repeatable by its operation ID, whose result commits with the plan.
 */
export class AgentPlanWriteOperations {
  private readonly dependencies: AgentPlanWriteDependencies;

  public constructor(dependencies: AgentPlanWriteDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Runs one change for the person.
   *
   * @param userId - The verified person.
   * @param operation - The change.
   * @param input - The raw parameters.
   */
  public async write(
    userId: string,
    operation: AgentPlanWriteOperation,
    input: unknown,
  ): Promise<PagesAgentWriteResponse> {
    const request = readPlanWriteRequest(operation, input);
    const stored = await this.lookup(userId, request.operationId);
    if (stored) return this.replay(userId, request, stored);
    const recorder = new OperationRecorder<AgentPlanChanged>(userId, request);
    try {
      if (request.operation === "plans.create")
        await this.create(userId, request, recorder);
      else await this.update(userId, request, recorder);
    } catch (error: unknown) {
      // A parallel call with the same operation ID may have committed first;
      // its result is the answer to this one.
      const completed =
        error instanceof StoredOperationFound
          ? error.stored
          : await this.lookup(userId, request.operationId);
      if (completed) return this.replay(userId, request, completed);
      throw error;
    }
    return { apiVersion: "1", result: recorder.result };
  }

  private async lookup(
    userId: string,
    operationId: string,
  ): Promise<StoredAgentOperation | null> {
    return this.dependencies.database.transaction((transaction) =>
      new AgentOperationKeyRepository(transaction).find(userId, operationId),
    );
  }

  /** Shows a stored result again only while the person still owns the plan. */
  private async replay(
    userId: string,
    request: AgentPlanWriteRequest,
    stored: StoredAgentOperation,
  ): Promise<PagesAgentWriteResponse> {
    if (
      stored.operation !== request.operation ||
      stored.fingerprint !== fingerprintOperation(request)
    )
      throw new AgentOperationError("CONFLICT");
    const result = readStoredResult(stored.resultJson);
    const plan = await this.dependencies.plans.view(userId, result.planId);
    if (!plan.canEdit) throw new AgentOperationError("NOT_FOUND");
    return { apiVersion: "1", result };
  }

  private async agents(
    userId: string,
    workspaceId: string,
    changes: readonly AgentPlanChange[],
  ): Promise<readonly AgentDefinitionChoice[]> {
    return needsAgents(changes)
      ? this.dependencies.plans.agents(userId, workspaceId)
      : [];
  }

  private async create(
    userId: string,
    request: AgentPlanCreateRequest,
    recorder: OperationRecorder<AgentPlanChanged>,
  ): Promise<void> {
    let agents: readonly AgentDefinitionChoice[];
    try {
      agents = await this.agents(userId, request.workspaceId, request.changes);
    } catch (error: unknown) {
      // A workspace the person cannot use for plans is an input to change, not a missing plan.
      if (error instanceof AgentError && error.code === "plan_access_denied")
        throw new AgentOperationError("INVALID_REQUEST", {
          reason: "workspace_unavailable",
        });
      throw error;
    }
    const base: AgentPlanInput = {
      name: request.name,
      workspaceId: request.workspaceId,
      ...planSharing(
        request.sharing ?? {
          scope: "private",
          groupIds: [],
          departmentIds: [],
        },
      ),
      globals: {},
      nodes: [],
      edges: [],
    };
    const { plan, createdNodeIds } = applyPlanChanges(base, request.changes, {
      agents,
    });
    await this.dependencies.plans.save(
      userId,
      null,
      plan,
      (transaction, planId) =>
        recorder.store(transaction, {
          planId,
          changed: true,
          revision: 1,
          createdNodeIds,
        }),
    );
  }

  /** The plan as the client last read it: visible, owned and not changed since. */
  private async current(
    userId: string,
    request: AgentPlanUpdateRequest,
  ): Promise<AgentPlanView> {
    const plan = await this.dependencies.plans.view(userId, request.planId);
    if (!plan.canEdit) throw new AgentOperationError("FORBIDDEN");
    if (plan.revision !== request.expectedRevision)
      throw new AgentOperationError("CONFLICT", {
        currentRevision: plan.revision,
      });
    // A parameter operation names a value node; any other node is no parameter.
    if (
      request.parameterId !== null &&
      !plan.nodes.some(
        (node) => node.id === request.parameterId && node.type === "parameter",
      )
    )
      throw new AgentOperationError("NOT_FOUND");
    return plan;
  }

  private async update(
    userId: string,
    request: AgentPlanUpdateRequest,
    recorder: OperationRecorder<AgentPlanChanged>,
  ): Promise<void> {
    const current = await this.current(userId, request);
    const before = editable(current);
    const changed = applyPlanChanges(before, request.changes, {
      agents: await this.agents(userId, current.workspaceId, request.changes),
    });
    const proposed: AgentPlanInput = {
      ...changed.plan,
      ...(request.name === null ? {} : { name: request.name }),
      ...(request.sharing === null ? {} : planSharing(request.sharing)),
    };
    const revision = request.expectedRevision;
    if (planKey(proposed) === planKey(before)) {
      await this.dependencies.database.transaction((transaction) =>
        recorder.store(transaction, {
          planId: current.id,
          changed: false,
          revision,
          createdNodeIds: [],
        }),
      );
      return;
    }
    try {
      await this.dependencies.plans.save(
        userId,
        current.id,
        proposed,
        (transaction) =>
          recorder.store(transaction, {
            planId: current.id,
            changed: true,
            revision: revision + 1,
            createdNodeIds: changed.createdNodeIds,
          }),
      );
    } catch (error: unknown) {
      if (error instanceof AgentError && error.code === "plan_conflict")
        throw await this.conflict(userId, current.id);
      throw error;
    }
  }

  /** A save lost to a change made in between answers with the revision to read next. */
  private async conflict(
    userId: string,
    planId: string,
  ): Promise<AgentOperationError> {
    try {
      const plan = await this.dependencies.plans.view(userId, planId);
      return new AgentOperationError("CONFLICT", {
        currentRevision: plan.revision,
      });
    } catch (error: unknown) {
      if (error instanceof AgentError)
        return new AgentOperationError("NOT_FOUND");
      throw error;
    }
  }
}
