import { requirePlanRevision } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { findPlanStep } from "@/definition/AgentPlanGroupEdit";
import { isPlanTemplateNode } from "@/definition/AgentPlanNodeTemplate";

import {
  fingerprintOperation,
  OperationRecorder,
  StoredOperationFound,
} from "./AgentOperationRecorder";
import { readPlanCommand } from "./AgentPlanCommandInput";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { AgentPlanView } from "@/definition/AgentPlan";
import type {
  AgentPlanCommandOperation,
  AgentPlanCommandResult,
} from "@/definition/AgentPlanOperations";
import type { AgentPlanCommandRequest } from "./AgentPlanCommandInput";
import type { AgentPlanService } from "./AgentPlanService";
import type { AgentPlanTemplateService } from "./AgentPlanTemplateService";

/** Explicit saved-plan and private-run commands share the editor services and transaction journal. */
export class AgentPlanCommandOperations {
  private readonly database: Pick<Database, "transaction">;
  private readonly plans: AgentPlanService;
  private readonly templates: AgentPlanTemplateService;
  private readonly queue = new SerialQueue();

  public constructor(dependencies: {
    readonly database: Pick<Database, "transaction">;
    readonly plans: AgentPlanService;
    readonly templates: AgentPlanTemplateService;
  }) {
    this.database = dependencies.database;
    this.plans = dependencies.plans;
    this.templates = dependencies.templates;
  }

  /** Applies one command or returns its committed acknowledgement after fresh access checks. */
  public async write(
    userId: string,
    operation: AgentPlanCommandOperation,
    input: unknown,
  ): Promise<AgentPlanCommandResult> {
    const request = readPlanCommand(operation, input);
    return this.queue.run(async () => {
      const stored = await this.lookup(userId, request.operationId);
      if (stored) return this.replay(userId, request, stored);
      const recorder = new OperationRecorder<AgentPlanCommandResult>(
        userId,
        request,
      );
      try {
        await this.apply(userId, request, recorder);
      } catch (error: unknown) {
        const completed =
          error instanceof StoredOperationFound
            ? error.stored
            : await this.lookup(userId, request.operationId);
        if (completed) return this.replay(userId, request, completed);
        throw error;
      }
      return recorder.result;
    });
  }

  private async lookup(
    userId: string,
    operationId: string,
  ): Promise<StoredAgentOperation | null> {
    return this.database.transaction((transaction) =>
      new AgentOperationKeyRepository(transaction).find(userId, operationId),
    );
  }

  private async replay(
    userId: string,
    request: AgentPlanCommandRequest,
    stored: StoredAgentOperation,
  ): Promise<AgentPlanCommandResult> {
    if (
      stored.operation !== request.operation ||
      stored.fingerprint !== fingerprintOperation(request)
    )
      throw new AgentOperationError("CONFLICT");
    const result = readCommandResult(stored.resultJson, request.planId);
    if (request.operation === "plans.delete")
      return { ...result, deleted: true };
    const plan = await this.plans.view(userId, request.planId);
    if (!plan.canEdit) throw new AgentOperationError("FORBIDDEN");
    if (result.runId) await this.plans.run(userId, result.runId);
    if (
      result.templateId &&
      !(await this.templates.list(userId, plan.workspaceId)).some(
        (entry) => entry.id === result.templateId,
      )
    )
      throw new AgentOperationError("NOT_FOUND");
    return result;
  }

  private async apply(
    userId: string,
    request: AgentPlanCommandRequest,
    recorder: OperationRecorder<AgentPlanCommandResult>,
  ): Promise<void> {
    const plan = await this.plans.view(userId, request.planId);
    if (!plan.canEdit) throw new AgentOperationError("FORBIDDEN");
    if (plan.revision !== request.expectedRevision)
      throw new AgentOperationError("CONFLICT", {
        currentRevision: plan.revision,
      });
    const base = { planId: plan.id, revision: plan.revision };
    if (request.operation === "plans.delete") {
      if (plan.ownerId !== userId) throw new AgentOperationError("FORBIDDEN");
      await this.plans.remove(userId, plan.id, {
        revision: plan.revision,
        journal: (transaction) =>
          recorder.store(transaction, { ...base, deleted: true }),
      });
      return;
    }
    if (request.operation === "plans.templates.save") {
      await this.saveTemplate(userId, { request, plan, recorder });
      return;
    }
    const journal = async (
      transaction: DatabaseTransaction,
      run: { readonly id: string },
    ): Promise<void> => {
      await requirePlanRevision(
        transaction,
        request.planId,
        request.expectedRevision,
      );
      await recorder.store(transaction, { ...base, runId: run.id });
    };
    if (request.operation === "plans.play") {
      await this.plans.play(userId, plan.id, plan.revision, journal);
      return;
    }
    if (request.runId === null)
      throw new AgentOperationError("INVALID_REQUEST");
    const run = await this.plans.run(userId, request.runId);
    if (run.planId !== plan.id) throw new AgentOperationError("NOT_FOUND");
    if (request.operation === "plans.resume")
      await this.plans.resume(userId, run.id, plan.revision, journal);
    else if (request.operation === "plans.pause")
      await this.plans.pause(userId, run.id, journal);
    else await this.plans.stop(userId, run.id, journal);
  }

  private async saveTemplate(
    userId: string,
    context: {
      readonly request: AgentPlanCommandRequest;
      readonly plan: AgentPlanView;
      readonly recorder: OperationRecorder<AgentPlanCommandResult>;
    },
  ): Promise<void> {
    const { request, plan, recorder } = context;
    const node =
      plan.nodes.find((entry) => entry.id === request.nodeId) ??
      findPlanStep(plan, request.nodeId ?? "")?.step;
    if (!node || !isPlanTemplateNode(node) || request.name === null)
      throw new AgentOperationError("INVALID_REQUEST", {
        reason: "element_missing",
      });
    await this.templates.save(
      userId,
      { planId: plan.id, workspaceId: plan.workspaceId },
      { name: request.name, node },
      async (transaction, template) => {
        await requirePlanRevision(
          transaction,
          request.planId,
          request.expectedRevision,
        );
        await recorder.store(transaction, {
          planId: plan.id,
          revision: plan.revision,
          templateId: template.id,
        });
      },
    );
  }
}

function readCommandResult(
  json: string,
  planId: string,
): AgentPlanCommandResult {
  const result: unknown = JSON.parse(json);
  if (
    typeof result !== "object" ||
    result === null ||
    !("planId" in result) ||
    result.planId !== planId ||
    !("revision" in result) ||
    typeof result.revision !== "number"
  )
    throw new AgentOperationError("CONFLICT");
  return {
    planId,
    revision: result.revision,
    ...("runId" in result && typeof result.runId === "string"
      ? { runId: result.runId }
      : {}),
    ...("templateId" in result && typeof result.templateId === "string"
      ? { templateId: result.templateId }
      : {}),
  };
}
