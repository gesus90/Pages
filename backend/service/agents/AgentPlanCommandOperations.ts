import { requirePlanRevision } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentError, isAgentErrorCode } from "@/backend/error/AgentErrors";
import { planStartRejectionIssuesSchema } from "@/backend/agents/AgentPlanStartRejectionInput";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { findPlanStep } from "@/definition/AgentPlanGroupEdit";
import { isPlanTemplateNode } from "@/definition/AgentPlanNodeTemplate";

import {
  fingerprintOperation,
  OperationRecorder,
  StoredOperationFound,
} from "./AgentOperationRecorder";
import { readPlanCommand } from "./AgentPlanCommandInput";
import { requireAgentConfirmation } from "./AgentConfirmation";
import { readPlanControlEntry } from "./AgentPlanControlViews";
import { translatePlanError } from "./AgentPlanOperationErrors";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { AgentPlanRun, AgentPlanView } from "@/definition/AgentPlan";
import type { AgentPlanStartRejection } from "@/definition/AgentPlanStartRejection";
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
      if (operation === "plans.delete")
        await this.database.transaction((transaction) =>
          requireAgentConfirmation(transaction, userId, request.confirmation),
        );
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
      return this.outcome(userId, request, recorder.result);
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
    const result = readCommandResult(stored.resultJson);
    if (request.operation === "plans.delete")
      return {
        planId: request.planId,
        revision: request.expectedRevision,
        deleted: true,
        action: request.operation,
        status: "deleted",
      };
    const plan = await this.plans.view(userId, request.planId);
    if (request.operation !== "plans.clone" && !plan.canEdit)
      throw new AgentOperationError("FORBIDDEN");
    const rejection = readCommandRejection(stored.resultJson);
    if (rejection) {
      if (
        request.operation !== "plans.play" ||
        result.planId !== request.planId
      )
        throw new AgentOperationError("CONFLICT");
      if (rejection.issues)
        throw new AgentOperationError("INVALID_REQUEST", {
          reason: "graph_invalid",
          issues: rejection.issues,
          issueDetailsFiltered: rejection.issueDetailsFiltered,
        });
      throw translatePlanError(new AgentError(rejection.code));
    }
    if (request.operation === "plans.clone") {
      const target = await this.plans.view(userId, result.planId);
      if (!target.canEdit) throw new AgentOperationError("NOT_FOUND");
      await this.plans.checkNodes(userId, target.workspaceId, target.nodes);
    }
    if (result.runId) await this.commandRun(userId, request, result.runId);
    if (
      result.templateId &&
      !(await this.templates.list(userId, plan.workspaceId)).some(
        (entry) => entry.id === result.templateId,
      )
    )
      throw new AgentOperationError("NOT_FOUND");
    return this.outcome(userId, request, result);
  }

  private async outcome(
    userId: string,
    request: AgentPlanCommandRequest,
    result: AgentPlanCommandResult,
  ): Promise<AgentPlanCommandResult> {
    if (request.operation === "plans.delete")
      return { ...result, action: request.operation, status: "deleted" };
    const control = await readPlanControlEntry(
      this.plans,
      userId,
      result.planId,
    );
    if (!result.runId)
      return {
        ...result,
        action: request.operation,
        status: control.status,
        control,
      };
    const run = await this.commandRun(userId, request, result.runId);
    return {
      ...result,
      action: request.operation,
      status: run.status,
      planRevision: run.continuation?.planRevision ?? run.planRevision,
      control,
    };
  }

  private async apply(
    userId: string,
    request: AgentPlanCommandRequest,
    recorder: OperationRecorder<AgentPlanCommandResult>,
  ): Promise<void> {
    const plan = await this.plans.view(userId, request.planId);
    if (request.operation !== "plans.clone" && !plan.canEdit)
      throw new AgentOperationError("FORBIDDEN");
    if (plan.revision !== request.expectedRevision)
      throw new AgentOperationError("CONFLICT", {
        currentRevision: plan.revision,
      });
    const base = { planId: plan.id, revision: plan.revision };
    if (request.operation === "plans.clone") {
      if (request.name === null)
        throw new AgentOperationError("INVALID_REQUEST");
      await this.plans.clone(
        userId,
        plan.id,
        {
          name: request.name,
          expectedRevision: request.expectedRevision,
          ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
        },
        (transaction, planId) =>
          recorder.store(transaction, {
            planId,
            revision: 1,
            sourcePlanId: plan.id,
            sourceRevision: plan.revision,
            workspaceId: request.workspaceId ?? plan.workspaceId,
          }),
      );
      return;
    }
    if (request.operation === "plans.delete") {
      if (plan.ownerId !== userId) throw new AgentOperationError("FORBIDDEN");
      await this.plans.remove(userId, plan.id, {
        revision: plan.revision,
        journal: async (transaction) => {
          await requireAgentConfirmation(
            transaction,
            userId,
            request.confirmation,
          );
          await recorder.store(transaction, { ...base, deleted: true });
        },
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
      const rejected = new OperationRecorder<{
        readonly planId: string;
        readonly revision: number;
        readonly rejection: string;
        readonly issues?: AgentPlanStartRejection["issues"];
        readonly issueDetailsFiltered?: boolean;
      }>(userId, request);
      const playJournal = Object.assign(journal, {
        recordStartRejection: async (
          transaction: DatabaseTransaction,
          entry: AgentPlanStartRejection,
        ) =>
          rejected.store(transaction, {
            ...base,
            rejection: entry.error,
            ...(entry.issues ? { issues: entry.issues } : {}),
            ...(entry.issueDetailsFiltered !== undefined
              ? { issueDetailsFiltered: entry.issueDetailsFiltered }
              : {}),
          }),
      });
      await this.plans.play(userId, plan.id, plan.revision, playJournal);
      return;
    }
    if (request.runId === null)
      throw new AgentOperationError("INVALID_REQUEST");
    const run = await this.commandRun(userId, request, request.runId);
    if (run.planId !== plan.id) throw new AgentOperationError("NOT_FOUND");
    if (request.operation === "plans.resume")
      await this.plans.resume(userId, run.id, plan.revision, journal);
    else if (request.operation === "plans.pause")
      await this.plans.pause(userId, run.id, journal);
    else await this.plans.stop(userId, run.id, journal);
  }

  private async commandRun(
    userId: string,
    request: AgentPlanCommandRequest,
    runId: string,
  ): Promise<AgentPlanRun> {
    const run =
      request.operation === "plans.stop"
        ? await this.plans.controlRun(userId, runId)
        : await this.plans.run(userId, runId);
    if (
      run.planId !== request.planId ||
      run.userId !== userId ||
      run.id !== runId
    )
      throw new AgentOperationError("NOT_FOUND");
    return run;
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

function readCommandRejection(json: string): {
  readonly code: AgentError["code"];
  readonly issues?: AgentPlanStartRejection["issues"];
  readonly issueDetailsFiltered?: boolean;
} | null {
  const input: unknown = JSON.parse(json);
  if (typeof input !== "object" || input === null || !("rejection" in input))
    return null;
  if (!isAgentErrorCode(input.rejection))
    throw new AgentOperationError("CONFLICT");
  if (!("issues" in input)) return { code: input.rejection };
  const issues = planStartRejectionIssuesSchema.safeParse(input.issues);
  if (
    input.rejection !== "plan_invalid" ||
    !issues.success ||
    ("issueDetailsFiltered" in input &&
      typeof input.issueDetailsFiltered !== "boolean")
  )
    throw new AgentOperationError("CONFLICT");
  return {
    code: input.rejection,
    issues: issues.data,
    ...("issueDetailsFiltered" in input
      ? { issueDetailsFiltered: input.issueDetailsFiltered === true }
      : {}),
  };
}

function readCommandResult(json: string): AgentPlanCommandResult {
  const result: unknown = JSON.parse(json);
  if (
    typeof result !== "object" ||
    result === null ||
    !("planId" in result) ||
    typeof result.planId !== "string" ||
    !("revision" in result) ||
    typeof result.revision !== "number"
  )
    throw new AgentOperationError("CONFLICT");
  return {
    planId: result.planId,
    revision: result.revision,
    ...("runId" in result && typeof result.runId === "string"
      ? { runId: result.runId }
      : {}),
    ...("templateId" in result && typeof result.templateId === "string"
      ? { templateId: result.templateId }
      : {}),
    ...readCloneResult(result),
  };
}

function readCloneResult(result: object): Partial<AgentPlanCommandResult> {
  return {
    ...("sourcePlanId" in result && typeof result.sourcePlanId === "string"
      ? { sourcePlanId: result.sourcePlanId }
      : {}),
    ...("sourceRevision" in result && typeof result.sourceRevision === "number"
      ? { sourceRevision: result.sourceRevision }
      : {}),
    ...("workspaceId" in result && typeof result.workspaceId === "string"
      ? { workspaceId: result.workspaceId }
      : {}),
  };
}
