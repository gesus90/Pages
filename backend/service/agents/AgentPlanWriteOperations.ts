import { requirePlanRevision } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  fingerprintOperation,
  OperationRecorder,
  StoredOperationFound,
} from "./AgentOperationRecorder";
import { readPlanWriteRequest } from "./AgentPlanOperationInput";
import { applyPlanChanges } from "./AgentPlanStructureChanges";
import { toSharing } from "./PageAgentOperationDefinition";

import type { AgentPlanTemplateService } from "./AgentPlanTemplateService";
import type { AgentPlanChangeContext } from "./AgentPlanStructureChanges";
import type { AgentPlanTemplateNode } from "@/definition/AgentPlanNodeTemplate";
import type { Database } from "@/backend/database/Database";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
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
  readonly templates?: AgentPlanTemplateService;
  readonly plans: Pick<
    AgentPlanService,
    "view" | "agents" | "save" | "workspaces" | "sources"
  > &
    Partial<Pick<AgentPlanService, "changeAccess" | "saveSettings">>;
}

/** Whether an update changes nothing but teams and owner. */
function isAccessOnly(request: AgentPlanUpdateRequest): boolean {
  return (
    request.name === null &&
    request.sharing === null &&
    (request.workspaceId ?? null) === null &&
    request.executionTarget === undefined &&
    request.oneShot === undefined &&
    request.changes.length === 0 &&
    request.parameterId === null
  );
}

/** The teams and owner an update asks for, or `null` when it keeps both. */
function accessChange(
  request: AgentPlanUpdateRequest,
): Pick<AgentPlanUpdateRequest, "teams" | "ownerId"> | null {
  if (request.teams === undefined && request.ownerId === undefined) return null;
  return {
    ...(request.teams === undefined ? {} : { teams: request.teams }),
    ...(request.ownerId === undefined ? {} : { ownerId: request.ownerId }),
  };
}

/**
 * Refuses an access change the person may not make before anything is written.
 *
 * @throws {AgentOperationError} `FORBIDDEN` for teams without the right to
 * manage them or an owner change by a non-administrator.
 */
function requireAccessRights(
  plan: AgentPlanView,
  change: Pick<AgentPlanUpdateRequest, "teams" | "ownerId">,
): void {
  if (
    (change.teams !== undefined && plan.rights?.canManageTeams !== true) ||
    (change.ownerId !== undefined && plan.rights?.canChangeOwner !== true)
  )
    throw new AgentOperationError("FORBIDDEN");
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
    plan.workspaceId,
    plan.projectId ?? null,
    plan.usage,
    plan.sharing ?? null,
    plan.executionTarget ?? null,
    plan.oneShot === true,
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
    ...(plan.executionTarget === undefined
      ? {}
      : { executionTarget: plan.executionTarget }),
    ...(plan.oneShot === true ? { oneShot: true } : {}),
    globals: plan.globals,
    nodes: plan.nodes,
    edges: plan.edges,
    revision: plan.revision,
  };
}

/** The one-time mark a change asks for; `false` removes it, absent keeps what the plan has. */
function oneShotChange(
  oneShot: boolean | undefined,
): Partial<Pick<AgentPlanInput, "oneShot">> {
  if (oneShot === undefined) return {};
  return oneShot ? { oneShot: true } : { oneShot: false };
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

/**
 * Creates plans and changes their structure, share and parameters.
 *
 * @remarks
 * Every change is saved by the plan service exactly like the plan page saves
 * it: the owner or a member or leader of the plan's team changes a plan, against the
 * revision read last, and the graph, the agents, tickets and references are
 * checked on save for the person who saves. Every one of them may change the
 * share and move the plan to another workspace of its project; only the owner
 * moves it to another project. A change is repeatable by its operation ID,
 * whose result commits with the plan.
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
      logCaughtError("AgentPlanWriteOperations", error);

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

  /** Shows a stored result again only while the person may still change the plan. */
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

  private async context(
    userId: string,
    planId: string | null,
    workspaceId: string,
    changes: readonly AgentPlanChange[],
  ): Promise<AgentPlanChangeContext> {
    const sources = await this.sources(userId, workspaceId);
    const templates = new Map<AgentPlanChange, AgentPlanTemplateNode>();
    for (const change of changes) {
      if (change.action !== "insertTemplate") continue;
      if (!this.dependencies.templates)
        throw new AgentOperationError("INVALID_REQUEST");
      templates.set(
        change,
        await this.dependencies.templates.insert(
          userId,
          { planId, workspaceId },
          change.templateId,
        ),
      );
    }
    return { agents: sources.agents, models: sources.models, templates };
  }

  private async sources(
    userId: string,
    workspaceId: string,
  ): ReturnType<AgentPlanService["sources"]> {
    try {
      return await this.dependencies.plans.sources(userId, workspaceId);
    } catch (error: unknown) {
      if (error instanceof AgentError && error.code === "plan_access_denied")
        throw new AgentOperationError("INVALID_REQUEST", {
          reason: "workspace_unavailable",
        });
      throw error;
    }
  }

  private async create(
    userId: string,
    request: AgentPlanCreateRequest,
    recorder: OperationRecorder<AgentPlanChanged>,
  ): Promise<void> {
    const base: AgentPlanInput = {
      name: request.name,
      workspaceId: request.workspaceId,
      ...(request.executionTarget === undefined
        ? {}
        : { executionTarget: request.executionTarget }),
      ...(request.oneShot === true ? { oneShot: true } : {}),
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
      ...(await this.context(
        userId,
        null,
        request.workspaceId,
        request.changes,
      )),
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

  /** The plan as the client last read it: visible, changeable by the person and not changed since. */
  private async current(
    userId: string,
    request: AgentPlanUpdateRequest,
  ): Promise<AgentPlanView> {
    const plan = await this.dependencies.plans.view(userId, request.planId);
    // A project manager may change only the teams of a plan they cannot change.
    const isTeamsOnly =
      request.teams !== undefined &&
      plan.rights?.canManageTeams === true &&
      isAccessOnly(request);
    if (!plan.canEdit && !isTeamsOnly)
      throw new AgentOperationError("FORBIDDEN");
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
    const access = accessChange(request);
    if (access) requireAccessRights(current, access);
    const workspace = await this.targetWorkspace(userId, current, request);
    const before = editable(current);
    const changed = applyPlanChanges(before, request.changes, {
      ...(await this.context(
        userId,
        current.id,
        workspace.id,
        request.changes,
      )),
    });
    const proposed: AgentPlanInput = {
      ...changed.plan,
      ...(request.name === null ? {} : { name: request.name }),
      ...(request.sharing === null ? {} : planSharing(request.sharing)),
      ...(request.executionTarget === undefined
        ? {}
        : { executionTarget: request.executionTarget }),
      ...oneShotChange(request.oneShot),
      workspaceId: workspace.id,
      projectId: workspace.projectId,
    };
    const revision = request.expectedRevision;
    const isSameGraph = planKey(proposed) === planKey(before);
    if (access) {
      await this.saveWithAccess(userId, {
        current,
        proposed: isSameGraph ? null : proposed,
        access,
        recorder,
        createdNodeIds: changed.createdNodeIds,
      });
      return;
    }
    if (isSameGraph) {
      await this.dependencies.database.transaction(async (transaction) => {
        await requirePlanRevision(transaction, current.id, revision);
        await recorder.store(transaction, {
          planId: current.id,
          changed: false,
          revision,
          createdNodeIds: [],
        });
      });
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
      logCaughtError("AgentPlanWriteOperations", error);

      if (error instanceof AgentError && error.code === "plan_conflict")
        throw await this.conflict(userId, current.id);
      throw error;
    }
  }

  /**
   * Saves the graph, if it changed, and then the teams and owner, each as a revision of its own.
   *
   * @remarks
   * The result is recorded with the commit of the access change, so a
   * repeated call returns it. The revision of the result counts both writes.
   */
  private async saveWithAccess(
    userId: string,
    write: {
      readonly current: AgentPlanView;
      readonly proposed: AgentPlanInput | null;
      readonly access: Pick<AgentPlanUpdateRequest, "teams" | "ownerId">;
      readonly recorder: OperationRecorder<AgentPlanChanged>;
      readonly createdNodeIds: readonly string[];
    },
  ): Promise<void> {
    const { current, recorder } = write;
    const { changeAccess } = this.dependencies.plans;
    if (!changeAccess) throw new AgentOperationError("INVALID_REQUEST");
    let revision = current.revision;
    try {
      if (write.proposed && this.dependencies.plans.saveSettings) {
        await this.dependencies.plans.saveSettings(userId, current.id, {
          plan: write.proposed,
          access: {
            ...write.access,
            revision,
            journal: (transaction) =>
              recorder.store(transaction, {
                planId: current.id,
                changed: true,
                revision: revision + 2,
                createdNodeIds: [...write.createdNodeIds],
              }),
          },
        });
        return;
      }
      if (write.proposed) {
        await this.dependencies.plans.save(userId, current.id, write.proposed);
        revision += 1;
      }
      await changeAccess.call(this.dependencies.plans, userId, current.id, {
        revision,
        ...write.access,
        journal: (transaction) =>
          recorder.store(transaction, {
            planId: current.id,
            changed: true,
            revision: revision + 1,
            createdNodeIds: [...write.createdNodeIds],
          }),
      });
    } catch (error: unknown) {
      logCaughtError("AgentPlanWriteOperations", error);

      if (error instanceof AgentError && error.code === "plan_conflict")
        throw await this.conflict(userId, current.id);
      throw error;
    }
  }

  /**
   * The workspace the plan is saved with: the current one, or the one the request names.
   *
   * @remarks
   * The workspace must be one the person may use now; the owner's access never
   * stands in. Another workspace of the plan's project is open to every team
   * member, a workspace of another project only to the owner.
   *
   * @throws {AgentOperationError} `INVALID_REQUEST` with `workspace_unavailable`
   * for a workspace the person cannot use, `FORBIDDEN` for another project
   * without owning the plan.
   */
  private async targetWorkspace(
    userId: string,
    current: AgentPlanView,
    request: AgentPlanUpdateRequest,
  ): Promise<{ readonly id: string; readonly projectId: string }> {
    const id = request.workspaceId ?? current.workspaceId;
    if (id === current.workspaceId) return { id, projectId: current.projectId };
    const choice = (await this.dependencies.plans.workspaces(userId)).find(
      (entry) => entry.id === id,
    );
    if (!choice)
      throw new AgentOperationError("INVALID_REQUEST", {
        reason: "workspace_unavailable",
      });
    if (choice.projectId !== current.projectId && current.ownerId !== userId)
      throw new AgentOperationError("FORBIDDEN");
    return { id, projectId: choice.projectId };
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
      logCaughtError("AgentPlanWriteOperations", error);

      if (error instanceof AgentError)
        return new AgentOperationError("NOT_FOUND");
      throw error;
    }
  }
}
