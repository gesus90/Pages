import { randomUUID } from "node:crypto";

import { z } from "zod";

import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AutomationRepository } from "@/backend/database/repositories/automation/AutomationRepository";
import { AutomationRunRepository } from "@/backend/database/repositories/automation/AutomationRunRepository";
import { AutomationError } from "@/backend/error/AutomationError";
import {
  OperationReusedError,
  recordInterfaceOperation,
  replayInterfaceOperation,
} from "@/backend/service/InterfaceOperationJournal";

import {
  createInputSchema,
  deleteInputSchema,
  readAutomationInput,
  runInputSchema,
  setActiveInputSchema,
  updateInputSchema,
} from "./AutomationInput";
import { firstRunAt } from "./AutomationSchedule";
import { automationView } from "./AutomationViews";

import type { Database } from "@/backend/database/Database";
import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type {
  Automation,
  AutomationDeleted,
  AutomationDeletionScope,
  AutomationRunReceipt,
  AutomationTrigger,
} from "@/definition/Automation";
import type { InterfaceOperation } from "@/backend/service/InterfaceOperationJournal";
import type { AutomationAccess } from "./AutomationAccess";
import type { AutomationAccount } from "./AutomationDirectory";
import type { AutomationReads } from "./AutomationReads";
import type { AutomationUpdateInput } from "./AutomationInput";

/** What the changes are built from. */
export interface AutomationWriteDependencies {
  readonly database: Pick<Database, "query" | "execute" | "transaction">;
  readonly access: AutomationAccess;
  readonly reads: AutomationReads;
  readonly now: () => Date;
  /** Nudges the scheduler of this process after a manual run was queued. */
  readonly wake?: () => void;
}

/** A change of fields of an automation. */
type AutomationPatch = Omit<
  AutomationUpdateInput,
  "operationId" | "automationId" | "expectedRevision"
>;

type Replayed<Result> = Result & { readonly replayed?: boolean };

const automationResultSchema = z.custom<Automation>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "revision" in value,
);
const receiptSchema = z.custom<AutomationRunReceipt>(
  (value) => typeof value === "object" && value !== null && "runId" in value,
);
const deletedSchema = z.custom<AutomationDeleted>(
  (value) =>
    typeof value === "object" && value !== null && "isDeleted" in value,
);

function conflict(currentRevision: number | undefined): AutomationError {
  return new AutomationError("conflict", {
    reason: "revision_conflict",
    currentRevision,
  });
}

function requireFutureTime(trigger: AutomationTrigger, now: Date): void {
  if (
    trigger.type === "once" &&
    (trigger.at === null || Date.parse(trigger.at) <= now.getTime())
  )
    throw new AutomationError("invalid_request", { reason: "time_required" });
}

function hasPassed(trigger: AutomationTrigger, now: Date): boolean {
  return (
    trigger.type === "once" &&
    trigger.at !== null &&
    Date.parse(trigger.at) <= now.getTime()
  );
}

/**
 * The switch state, trigger and next run after a patch.
 *
 * @remarks
 * Switching a once automation off after its time passed clears the time;
 * switching it on needs a time in the future. A new trigger or switching on
 * plans the next run anew; otherwise the planned time stays.
 */
function scheduleOf(
  automation: StoredAutomation,
  patch: AutomationPatch,
  now: Date,
): {
  readonly isActive: boolean;
  readonly trigger: AutomationTrigger;
  readonly nextRunAt: string | null;
} {
  if (patch.trigger) requireFutureTime(patch.trigger, now);
  const isActive = patch.isActive ?? automation.isActive;
  const isSwitchingOn = isActive && !automation.isActive;
  let trigger = patch.trigger ?? automation.trigger;
  if (!isActive && trigger.type === "once" && hasPassed(trigger, now))
    trigger = { ...trigger, at: null };
  if (isSwitchingOn) requireFutureTime(trigger, now);
  if (!isActive) return { isActive, trigger, nextRunAt: null };
  const needsSchedule = patch.trigger !== undefined || isSwitchingOn;
  return {
    isActive,
    trigger,
    nextRunAt: needsSchedule ? firstRunAt(trigger, now) : automation.nextRunAt,
  };
}

/**
 * Creates, changes, switches, runs and deletes automations (PAGE-297).
 *
 * @remarks
 * Every change carries an operation ID: a repetition with the same input
 * answers the stored receipt without a second effect, other input with the
 * same ID is a conflict. Changes of an existing automation compare the
 * expected revision and change nothing on a conflict.
 */
export class AutomationWrites {
  private readonly dependencies: AutomationWriteDependencies;

  public constructor(dependencies: AutomationWriteDependencies) {
    this.dependencies = dependencies;
  }

  /** Creates an automation owned by the calling account. */
  public async create(
    userId: string,
    input: unknown,
  ): Promise<Replayed<Automation>> {
    const request = readAutomationInput(createInputSchema, input);
    const { access, now } = this.dependencies;
    const actor = await access.actor(userId);
    const journal = this.journal(actor, "automations.create", request);
    const replayed = await this.replay(journal, automationResultSchema);
    if (replayed) return { ...replayed, replayed: true };
    if (actor.isReadOnly)
      throw new AutomationError("forbidden", { reason: "read_only" });
    const time = now();
    requireFutureTime(request.trigger, time);
    const isActive = request.isActive ?? false;
    const stored: StoredAutomation = {
      id: randomUUID(),
      creatorId: actor.id,
      name: request.name,
      trigger: request.trigger,
      action: request.action,
      sharing: request.sharing ?? { scope: "private" },
      isActive,
      deleteAfterSuccess: request.deleteAfterSuccess ?? false,
      agentNotification: request.agentNotification ?? { mode: "off" },
      nextRunAt: isActive ? firstRunAt(request.trigger, time) : null,
      revision: 1,
      createdAt: time.toISOString(),
      updatedAt: time.toISOString(),
    };
    await access.checkDefinition(
      stored,
      { creator: actor, editor: actor },
      { trigger: true, action: true, sharing: true, agentNotification: true },
    );
    const view = await this.view(stored, actor);
    return this.commit(journal, automationResultSchema, async (transaction) => {
      await new AutomationRepository(transaction).insert(stored);
      return view;
    });
  }

  /** Patches an automation. */
  public async update(
    userId: string,
    input: unknown,
  ): Promise<Replayed<Automation>> {
    const request = readAutomationInput(updateInputSchema, input);
    const { operationId, automationId, expectedRevision, ...patch } = request;
    return this.change(userId, "automations.update", {
      operationId,
      automationId,
      expectedRevision,
      patch,
    });
  }

  /** Switches an automation on or off. */
  public async setActive(
    userId: string,
    input: unknown,
  ): Promise<Replayed<Automation>> {
    const request = readAutomationInput(setActiveInputSchema, input);
    return this.change(userId, "automations.setActive", {
      operationId: request.operationId,
      automationId: request.automationId,
      expectedRevision: request.expectedRevision,
      patch: { isActive: request.isActive },
    });
  }

  /** Queues a manual run; the receipt is no finished run. */
  public async run(
    userId: string,
    input: unknown,
  ): Promise<Replayed<AutomationRunReceipt>> {
    const request = readAutomationInput(runInputSchema, input);
    const { access, reads, now } = this.dependencies;
    const actor = await access.actor(userId);
    const journal = this.journal(actor, "automations.run", request);
    const replayed = await this.replay(journal, receiptSchema);
    if (replayed) return { ...replayed, replayed: true };
    const { automation, permissions } = await reads.requireVisible(
      request.automationId,
      actor,
    );
    if (!permissions.canRun) throw new AutomationError("forbidden");
    if (automation.revision !== request.expectedRevision)
      throw conflict(automation.revision);
    const receipt = await this.commit(
      journal,
      receiptSchema,
      async (transaction) => {
        const runs = new AutomationRunRepository(transaction);
        const blocking = await runs.blocking(automation.id);
        const isRunning = blocking !== null && blocking.status !== "queued";
        const queued = await runs.enqueue({
          id: randomUUID(),
          automationId: automation.id,
          triggerKind: "manual",
          eventType: null,
          triggerSubject: null,
          triggerData: null,
          requestedBy: actor.id,
          queuedAt: now().toISOString(),
        });
        const status: AutomationRunReceipt["status"] = isRunning
          ? "queued"
          : "accepted";
        return {
          runId: queued.run.id,
          automationId: automation.id,
          status,
          isCoalesced: queued.isCoalesced,
          queuedAt: queued.run.queuedAt,
        };
      },
    );
    this.dependencies.wake?.();
    return receipt;
  }

  /**
   * Answers the scope of a deletion, or deletes after an explicit confirmation.
   *
   * @param userId - The calling account.
   * @param input - The raw input of the deletion.
   */
  public async delete(
    userId: string,
    input: unknown,
  ): Promise<AutomationDeletionScope | Replayed<AutomationDeleted>> {
    const request = readAutomationInput(deleteInputSchema, input);
    const { access, reads, database } = this.dependencies;
    const actor = await access.actor(userId);
    const fingerprinted = {
      operationId: request.operationId,
      automationId: request.automationId,
      expectedRevision: request.expectedRevision,
      confirmed: request.confirmed,
    };
    const journal = this.journal(actor, "automations.delete", fingerprinted);
    if (request.confirmed) {
      const replayed = await this.replay(journal, deletedSchema);
      if (replayed) return { ...replayed, replayed: true };
    }
    const { automation, permissions } = await reads.requireVisible(
      request.automationId,
      actor,
    );
    if (!permissions.canDelete) throw new AutomationError("forbidden");
    if (automation.revision !== request.expectedRevision)
      throw conflict(automation.revision);
    const runs = new AutomationRunRepository(database);
    const [runCount, blocking] = await Promise.all([
      runs.count(automation.id),
      runs.blocking(automation.id),
    ]);
    if (!request.confirmed)
      return {
        confirmationRequired: true,
        automationId: automation.id,
        name: automation.name,
        expectedRevision: automation.revision,
        runCount,
        blockingRunId: blocking?.id ?? null,
        canDelete: blocking === null,
      };
    if (blocking)
      throw new AutomationError("conflict", {
        reason: "run_active",
        currentRevision: automation.revision,
      });
    return this.commit(journal, deletedSchema, async (transaction) => {
      const automations = new AutomationRepository(transaction);
      const locked = await automations.lock(automation.id);
      if (locked?.revision !== request.expectedRevision)
        throw conflict(locked?.revision);
      if (
        await new AutomationRunRepository(transaction).blocking(automation.id)
      )
        throw new AutomationError("conflict", {
          reason: "run_active",
          currentRevision: locked.revision,
        });
      await automations.delete(automation.id);
      return {
        automationId: automation.id,
        isDeleted: true,
        removedRuns: runCount,
      };
    });
  }

  private async change(
    userId: string,
    operation: "automations.update" | "automations.setActive",
    request: {
      readonly operationId: string;
      readonly automationId: string;
      readonly expectedRevision: number;
      readonly patch: AutomationPatch;
    },
  ): Promise<Replayed<Automation>> {
    const { access, reads, now } = this.dependencies;
    const actor = await access.actor(userId);
    const journal = this.journal(actor, operation, {
      operationId: request.operationId,
      automationId: request.automationId,
      expectedRevision: request.expectedRevision,
      ...request.patch,
    });
    const replayed = await this.replay(journal, automationResultSchema);
    if (replayed) return { ...replayed, replayed: true };
    if (actor.isReadOnly)
      throw new AutomationError("forbidden", { reason: "read_only" });
    const { automation, permissions } = await reads.requireVisible(
      request.automationId,
      actor,
    );
    if (!permissions.canEdit) throw new AutomationError("forbidden");
    if (automation.revision !== request.expectedRevision)
      throw conflict(automation.revision);
    const next = this.merge(automation, request.patch, now());
    const creator = await access.account(automation.creatorId);
    if (!creator) throw new AutomationError("forbidden");
    const { patch } = request;
    await access.checkDefinition(
      next,
      { creator, editor: actor },
      {
        trigger: patch.trigger !== undefined,
        action: patch.action !== undefined,
        sharing: patch.sharing !== undefined,
        agentNotification: patch.agentNotification !== undefined,
      },
    );
    const view = await this.view(next, actor);
    return this.commit(journal, automationResultSchema, async (transaction) => {
      const automations = new AutomationRepository(transaction);
      if (!(await automations.replace(next, request.expectedRevision)))
        throw conflict((await automations.find(automation.id))?.revision);
      return view;
    });
  }

  /** Applies a patch and the rules of once triggers and of the next run. */
  private merge(
    automation: StoredAutomation,
    patch: AutomationPatch,
    now: Date,
  ): StoredAutomation {
    const { isActive, trigger, nextRunAt } = scheduleOf(automation, patch, now);
    const deleteAfterSuccess =
      patch.deleteAfterSuccess ??
      (trigger.type === "once" ? automation.deleteAfterSuccess : false);
    return {
      ...automation,
      name: patch.name ?? automation.name,
      trigger,
      action: patch.action ?? automation.action,
      sharing: patch.sharing ?? automation.sharing,
      agentNotification:
        patch.agentNotification ?? automation.agentNotification,
      isActive,
      deleteAfterSuccess,
      nextRunAt,
      revision: automation.revision + 1,
      updatedAt: now.toISOString(),
    };
  }

  private async view(
    automation: StoredAutomation,
    actor: AutomationAccount,
  ): Promise<Automation> {
    const { access, reads } = this.dependencies;
    const [view] = await reads.views([automation], actor);
    if (view) return view;
    const permissions = await access.permissions(automation, actor);
    return automationView(automation, {
      creator: actor,
      permissions,
      canSeeScript: access.canSeeScript(automation, actor, permissions),
      lastRun: null,
    });
  }

  private journal(
    actor: AutomationAccount,
    operation: string,
    request: Readonly<Record<string, unknown>> & {
      readonly operationId: string;
    },
  ): InterfaceOperation {
    const { operationId, ...rest } = request;
    return { userId: actor.id, operation, operationId, request: rest };
  }

  private async replay<Result>(
    journal: InterfaceOperation,
    schema: z.ZodType<Result>,
  ): Promise<Result | null> {
    try {
      return await replayInterfaceOperation(
        new AgentOperationKeyRepository(this.dependencies.database),
        journal,
        schema,
      );
    } catch (error: unknown) {
      if (error instanceof OperationReusedError)
        throw new AutomationError("conflict", { reason: "operation_reused" });
      throw error;
    }
  }

  /** Runs a change and stores its receipt in the same transaction. */
  private async commit<Result extends object>(
    journal: InterfaceOperation,
    schema: z.ZodType<Result>,
    work: (
      transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    ) => Promise<Result>,
  ): Promise<Replayed<Result>> {
    try {
      return await this.dependencies.database.transaction(
        async (transaction) => {
          const keys = new AgentOperationKeyRepository(transaction);
          const earlier = await replayInterfaceOperation(keys, journal, schema);
          if (earlier) return { ...earlier, replayed: true };
          const result = await work(transaction);
          await recordInterfaceOperation(keys, journal, result);
          return result;
        },
      );
    } catch (error: unknown) {
      if (error instanceof OperationReusedError)
        throw new AutomationError("conflict", { reason: "operation_reused" });
      throw error;
    }
  }
}
