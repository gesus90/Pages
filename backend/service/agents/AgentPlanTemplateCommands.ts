import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { findPlanStep } from "@/definition/AgentPlanGroupEdit";
import { isPlanTemplateNode } from "@/definition/AgentPlanNodeTemplate";

import {
  fingerprintOperation,
  OperationRecorder,
  StoredOperationFound,
} from "./AgentOperationRecorder";
import { requireAgentConfirmation } from "./AgentConfirmation";
import { readPlanTemplateCommand } from "./AgentPlanCommandInput";

import type { Database } from "@/backend/database/Database";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type {
  AgentPlanTemplateCommandOperation,
  AgentPlanTemplateCommandResult,
} from "@/definition/AgentPlanOperations";
import type { AgentPlanTemplateCommandRequest } from "./AgentPlanCommandInput";
import type { AgentPlanService } from "./AgentPlanService";
import type {
  AgentPlanTemplateRevision,
  AgentPlanTemplateService,
} from "./AgentPlanTemplateService";

/** What a stored template command keeps under its operation ID. */
type StoredTemplateResult = Pick<
  AgentPlanTemplateCommandResult,
  "action" | "templateId" | "deleted"
>;

/**
 * Renames, replaces and deletes node templates for the agent tools and the paired machines.
 *
 * @remarks
 * Every call runs through the template service of the plan editor, so only
 * the owner changes a template and a replacing node takes the checks of a new
 * template. The operation ID is stored in the commit of the change; a repeated
 * call with the same request returns the first result after a fresh read, a
 * different request under the same ID is a conflict. A deletion needs the
 * confirmation word of the person, checked again in its commit.
 */
export class AgentPlanTemplateCommands {
  private readonly database: Pick<Database, "transaction">;
  private readonly plans: Pick<AgentPlanService, "view">;
  private readonly templates: AgentPlanTemplateService;

  public constructor(dependencies: {
    readonly database: Pick<Database, "transaction">;
    readonly plans: Pick<AgentPlanService, "view">;
    readonly templates: AgentPlanTemplateService;
  }) {
    this.database = dependencies.database;
    this.plans = dependencies.plans;
    this.templates = dependencies.templates;
  }

  /**
   * Applies one template command, or answers a repetition of it.
   *
   * @param userId - The verified person.
   * @param operation - `plans.templates.update` or `plans.templates.delete`.
   * @param input - The raw parameters.
   * @throws {AgentOperationError} `INVALID_REQUEST` for malformed input or a
   * missing node, `CONFIRMATION_REQUIRED` for a deletion without the right
   * word, `CONFLICT` for a reused operation ID and, with `template_name_taken`,
   * for a name the owner already uses.
   */
  public async write(
    userId: string,
    operation: AgentPlanTemplateCommandOperation,
    input: unknown,
  ): Promise<AgentPlanTemplateCommandResult> {
    const request = readPlanTemplateCommand(operation, input);
    if (operation === "plans.templates.delete")
      await this.database.transaction((transaction) =>
        requireAgentConfirmation(transaction, userId, request.confirmation),
      );
    const stored = await this.lookup(userId, request.operationId);
    if (stored) return this.replay(userId, request, stored);
    const recorder = new OperationRecorder<StoredTemplateResult>(
      userId,
      request,
    );
    try {
      return await this.apply(userId, request, recorder);
    } catch (error: unknown) {
      const completed =
        error instanceof StoredOperationFound
          ? error.stored
          : await this.lookup(userId, request.operationId);
      if (completed) return this.replay(userId, request, completed);
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

  private async replay(
    userId: string,
    request: AgentPlanTemplateCommandRequest,
    stored: StoredAgentOperation,
  ): Promise<AgentPlanTemplateCommandResult> {
    if (
      stored.operation !== request.operation ||
      stored.fingerprint !== fingerprintOperation(request)
    )
      throw new AgentOperationError("CONFLICT");
    const base = { action: request.operation, templateId: request.templateId };
    if (request.operation === "plans.templates.delete")
      return { ...base, deleted: true };
    const template = (
      await this.templates.list(userId, request.workspaceId)
    ).find((entry) => entry.id === request.templateId);
    if (!template) throw new AgentOperationError("NOT_FOUND");
    return { ...base, template };
  }

  private async apply(
    userId: string,
    request: AgentPlanTemplateCommandRequest,
    recorder: OperationRecorder<StoredTemplateResult>,
  ): Promise<AgentPlanTemplateCommandResult> {
    const target = {
      workspaceId: request.workspaceId,
      templateId: request.templateId,
    };
    const base = { action: request.operation, templateId: request.templateId };
    if (request.operation === "plans.templates.delete") {
      await this.templates.remove(userId, target, async (transaction) => {
        await requireAgentConfirmation(
          transaction,
          userId,
          request.confirmation,
        );
        await recorder.store(transaction, { ...base, deleted: true });
      });
      return { ...base, deleted: true };
    }
    const source = await this.source(userId, request);
    try {
      const template = await this.templates.update(
        userId,
        target,
        { name: request.name, source },
        (transaction) => recorder.store(transaction, base),
      );
      return { ...base, template };
    } catch (error: unknown) {
      // A rename collides with an existing template, unlike a malformed save.
      if (error instanceof AgentError && error.code === "template_name_taken")
        throw new AgentOperationError("CONFLICT", {
          reason: "template_name_taken",
        });
      throw error;
    }
  }

  /** The node of a saved plan that replaces the stored node, as `plans.templates.save` finds it. */
  private async source(
    userId: string,
    request: AgentPlanTemplateCommandRequest,
  ): Promise<AgentPlanTemplateRevision["source"]> {
    if (request.source === null) return null;
    const { planId, nodeId } = request.source;
    const plan = await this.plans.view(userId, planId);
    const node =
      plan.nodes.find((entry) => entry.id === nodeId) ??
      findPlanStep(plan, nodeId)?.step;
    if (!node || !isPlanTemplateNode(node))
      throw new AgentOperationError("INVALID_REQUEST", {
        reason: "element_missing",
      });
    return {
      context: { planId: plan.id, workspaceId: plan.workspaceId },
      node,
    };
  }
}
