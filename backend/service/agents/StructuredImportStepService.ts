import { createHash } from "node:crypto";

import { AgentImportRepository } from "@/backend/database/repositories/agents/AgentImportRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { logCaughtError } from "@/backend/logging/Logger";

import { agentTransactionScope } from "./AgentTransactionScope";
import { translateAgentTicketError } from "./AgentTicketErrors";
import {
  compareDependencyTarget,
  compareMilestoneTarget,
  compareTicketTarget,
  structuredStepHash,
} from "./StructuredImportDecision";
import { createStructuredImportEnvironment } from "./StructuredImportEnvironment";
import {
  failedStructuredItem,
  StructuredStepBlockedError,
  storedTargetId,
} from "./StructuredImportItems";
import { structuredKey } from "./StructuredImportPlanner";
import { wikiImportErrorCode } from "./WikiImportSourceService";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { StoredAgentImportSource } from "@/backend/database/repositories/agents/AgentImportRepository";
import type { AgentStructuredImportItem } from "@/definition/AgentStructuredImportManifest";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { AgentMilestoneService } from "./AgentMilestoneService";
import type { AgentTicketAnnouncer } from "./AgentTicketAnnouncer";
import type { AgentTicketService } from "./AgentTicketService";
import type { AgentTicketCompleted } from "./AgentTicketTransaction";
import type { StructuredImportEnvironment } from "./StructuredImportEnvironment";
import type {
  StructuredDependencyStep,
  StructuredImportGraph,
  StructuredStep,
} from "./StructuredImportPlanner";
import type {
  StructuredResolvedIds,
  StructuredTargetState,
} from "./StructuredImportDecision";

/** The server-owned collaborators of the milestone, ticket and dependency steps. */
export interface StructuredStepDependencies {
  readonly database: Database;
  readonly tickets: AgentTicketService;
  readonly milestones: AgentMilestoneService;
  readonly announcer: AgentTicketAnnouncer;
}

/** What a step needs to know about the run it belongs to. */
export interface StructuredRun {
  readonly id: string;
  readonly userId: string;
  readonly graph: StructuredImportGraph;
  readonly projectIds: ReadonlyMap<string, string>;
}

interface StepScope {
  readonly environment: StructuredImportEnvironment;
  readonly transaction: DatabaseTransaction;
}

interface StepOutcome {
  readonly item: AgentStructuredImportItem;
  readonly completed: AgentTicketCompleted<unknown> | null;
}

/** The targets a step builds on, resolved from the outcomes of this run only. */
interface Resolved extends StructuredResolvedIds {
  readonly fromId: string | null;
  readonly toId: string | null;
}

function operationIdOf(run: StructuredRun, step: StructuredStep): string {
  return `structured.import:${run.id}:${createHash("sha256").update(step.key).digest("hex")}`;
}

/** Reads the key and link a creation stored, which only this service writes. */
function storedCreation(json: string): {
  readonly key: string | null;
  readonly link: string | null;
} {
  const value: unknown = JSON.parse(json);
  if (typeof value !== "object" || value === null)
    return { key: null, link: null };
  const record = value as Record<string, unknown>;
  return {
    key: typeof record.key === "string" ? record.key : null,
    link: typeof record.link === "string" ? record.link : null,
  };
}

function item(
  step: StructuredStep,
  fields: Pick<AgentStructuredImportItem, "action" | "targetId"> &
    Partial<AgentStructuredImportItem>,
): AgentStructuredImportItem {
  return {
    kind: step.kind,
    sourceKey: step.key,
    targetKey: step.key,
    key: null,
    link: null,
    parentId: null,
    milestoneId: null,
    assets: [],
    reason: null,
    errorCode: null,
    ...fields,
  };
}

/**
 * Applies the milestones, tickets and dependencies of a structured import,
 * one source per transaction.
 *
 * @remarks
 * A step either commits its object, its mapping and its outcome together, or
 * nothing of it. The targets a step builds on come from the outcomes this run
 * recorded, never from a lookup by name. Events, cache and the GitHub
 * publication follow the commit, through the announcer of the ticket services.
 */
export class StructuredImportStepService {
  private readonly dependencies: StructuredStepDependencies;

  public constructor(dependencies: StructuredStepDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Applies one step, or finds its outcome already recorded.
   *
   * @param run - The run the step belongs to.
   * @param step - The step.
   * @param ordinal - Its position in the run.
   * @param verify - Verifies the credential of the call anew.
   * @throws Whatever is not a business failure of the step, which leaves the run resumable.
   */
  public async apply(
    run: StructuredRun,
    step: StructuredStep,
    ordinal: number,
    verify: () => Promise<AgentIdentity>,
  ): Promise<void> {
    let completed: AgentTicketCompleted<unknown> | null = null;
    try {
      if ((await verify()).userId !== run.userId)
        throw new McpAuthorizationError("invalid_token", 401);
      completed = await this.dependencies.database.transaction(
        async (transaction) => {
          const environment = await createStructuredImportEnvironment(
            agentTransactionScope(transaction),
            run.userId,
          );
          if (await environment.imports.findStoredItem(run.id, step.key))
            return null;
          const outcome = await this.applyOne(
            { environment, transaction },
            run,
            step,
          );
          await environment.imports.recordStructuredItem(
            run.id,
            ordinal,
            outcome.item,
          );
          return outcome.completed;
        },
      );
    } catch (error: unknown) {
      logCaughtError("StructuredImportStepService", error);

      await this.recordFailure(run, step, ordinal, error);
      return;
    }
    if (completed) this.dependencies.announcer.announce(completed);
  }

  private async recordFailure(
    run: StructuredRun,
    step: StructuredStep,
    ordinal: number,
    error: unknown,
  ): Promise<void> {
    const isBlocked = error instanceof StructuredStepBlockedError;
    const code = isBlocked
      ? "CONFLICT"
      : wikiImportErrorCode(translateAgentTicketError(error));
    if (!code) throw error;
    await this.dependencies.database.transaction(async (transaction) => {
      const imports = new AgentImportRepository(transaction);
      if (!(await imports.findStoredItem(run.id, step.key)))
        await imports.recordStructuredItem(
          run.id,
          ordinal,
          failedStructuredItem(step, code, isBlocked ? "blocked" : null),
        );
    });
  }

  private async applyOne(
    scope: StepScope,
    run: StructuredRun,
    step: StructuredStep,
  ): Promise<StepOutcome> {
    const projectId = run.projectIds.get(step.project);
    if (projectId === undefined)
      throw new AgentOperationError("INVALID_REQUEST");
    const resolved = await this.resolve(scope.environment, run, step);
    const hash = structuredStepHash(step, run.graph, run.projectIds);
    const mapping = await scope.environment.imports.findSource(
      projectId,
      step.key,
    );
    if (mapping)
      return this.repeat(scope, run, step, {
        mapping,
        hash,
        projectId,
        resolved,
      });
    if (step.kind === "milestone")
      return this.createMilestone(scope, run, step, { hash, projectId });
    if (step.kind === "ticket")
      return this.createTicket(scope, run, step, {
        hash,
        projectId,
        resolved,
      });
    return this.createDependency(scope, run, step, {
      hash,
      projectId,
      // resolve requires both milestone outcomes for this dependency or throws.
      resolved: resolved as Resolved & {
        readonly fromId: string;
        readonly toId: string;
      },
    });
  }

  /** Looks up the targets of the links of a step among this run's outcomes; a missing one blocks it. */
  private async resolve(
    environment: StructuredImportEnvironment,
    run: StructuredRun,
    step: StructuredStep,
  ): Promise<Resolved> {
    const target = async (
      kind: "ticket" | "milestone",
      key: string | undefined,
    ): Promise<string | null> => {
      if (key === undefined) return null;
      const id = storedTargetId(
        await environment.imports.findStoredItem(
          run.id,
          structuredKey(kind, key),
        ),
      );
      if (id === null) throw new StructuredStepBlockedError();
      return id;
    };
    if (step.kind === "dependency")
      return {
        parentId: null,
        milestoneId: null,
        fromId: await target("milestone", step.from),
        toId: await target("milestone", step.to),
      };
    if (step.kind === "milestone")
      return { parentId: null, milestoneId: null, fromId: null, toId: null };
    return {
      parentId: await target("ticket", run.graph.parents.get(step.name)),
      milestoneId: await target(
        "milestone",
        run.graph.milestones.get(step.name),
      ),
      fromId: null,
      toId: null,
    };
  }

  /** A mapped source is compared with its target; nothing is written except the baseline of an unchanged one. */
  private async repeat(
    scope: StepScope,
    run: StructuredRun,
    step: StructuredStep,
    context: {
      readonly mapping: StoredAgentImportSource;
      readonly hash: string;
      readonly projectId: string;
      readonly resolved: Resolved;
    },
  ): Promise<StepOutcome> {
    const { mapping, hash, projectId, resolved } = context;
    const { environment } = scope;
    let state: StructuredTargetState;
    if (step.kind === "ticket")
      state = await compareTicketTarget(environment, mapping, {
        step,
        graph: run.graph,
        hash,
        resolved,
      });
    else if (step.kind === "milestone")
      state = await compareMilestoneTarget(environment, mapping, {
        step,
        graph: run.graph,
        hash,
        projectId,
      });
    else
      state = await compareDependencyTarget(environment, mapping, {
        step,
        hash,
        projectId,
      });
    const stored = storedCreation(mapping.resultJson);
    const described = {
      // A target that is gone is not one to build on or to show.
      targetId: state.reason === "target_removed" ? null : mapping.targetId,
      key: stored.key,
      link: stored.link,
      parentId: resolved.parentId,
      milestoneId: resolved.milestoneId,
    };
    if (state.action === "conflict")
      return {
        item: item(step, {
          ...described,
          action: "conflict",
          reason: state.reason,
          errorCode: "CONFLICT",
        }),
        completed: null,
      };
    if (state.shouldRefresh)
      await environment.imports.refreshSource({
        projectId,
        sourceKey: step.key,
        contentHash: hash,
        targetRevision: 0,
        lastRunId: run.id,
      });
    else await environment.imports.touchSource(projectId, step.key, run.id);
    return {
      item: item(step, { ...described, action: "skipped" }),
      completed: null,
    };
  }

  private async createMilestone(
    scope: StepScope,
    run: StructuredRun,
    step: StructuredStep,
    context: { readonly hash: string; readonly projectId: string },
  ): Promise<StepOutcome> {
    const source = run.graph.sources.milestones.get(step.name);
    if (!source) throw new AgentOperationError("INVALID_REQUEST");
    const completed = await this.dependencies.milestones.createWithin(
      scope.transaction,
      run.userId,
      {
        operationId: operationIdOf(run, step),
        projectId: context.projectId,
        name: source.name,
        description: source.description,
        startAt: source.startAt,
        dueAt: source.dueAt,
      },
    );
    await scope.environment.imports.insertSource({
      projectId: context.projectId,
      sourceKey: step.key,
      targetKind: "milestone",
      targetId: completed.result.milestoneId,
      contentHash: context.hash,
      targetRevision: 0,
      resultJson: JSON.stringify(completed.result),
      lastRunId: run.id,
    });
    return {
      item: item(step, {
        action: "created",
        targetId: completed.result.milestoneId,
      }),
      completed,
    };
  }

  private async createTicket(
    scope: StepScope,
    run: StructuredRun,
    step: StructuredStep,
    context: {
      readonly hash: string;
      readonly projectId: string;
      readonly resolved: Resolved;
    },
  ): Promise<StepOutcome> {
    const source = run.graph.sources.tickets.get(step.name);
    if (!source) throw new AgentOperationError("INVALID_REQUEST");
    const { parentId, milestoneId } = context.resolved;
    const completed = await this.dependencies.tickets.createWithin(
      scope.transaction,
      run.userId,
      {
        operationId: operationIdOf(run, step),
        projectId: context.projectId,
        type: source.type,
        title: source.title,
        description: source.description,
        statusId: null,
        parent: parentId === null ? null : { id: parentId },
        milestoneId,
      },
    );
    await scope.environment.imports.insertSource({
      projectId: context.projectId,
      sourceKey: step.key,
      targetKind: "ticket",
      targetId: completed.result.ticketId,
      contentHash: context.hash,
      targetRevision: 0,
      resultJson: JSON.stringify(completed.result),
      lastRunId: run.id,
    });
    return {
      item: item(step, {
        action: "created",
        targetId: completed.result.ticketId,
        key: completed.result.key,
        link: completed.result.link,
        parentId,
        milestoneId,
      }),
      completed,
    };
  }

  private async createDependency(
    scope: StepScope,
    run: StructuredRun,
    step: StructuredDependencyStep,
    context: {
      readonly hash: string;
      readonly projectId: string;
      readonly resolved: Resolved & {
        readonly fromId: string;
        readonly toId: string;
      };
    },
  ): Promise<StepOutcome> {
    const { fromId, toId } = context.resolved;
    const completed = await this.dependencies.milestones.linkWithin(
      scope.transaction,
      run.userId,
      {
        operationId: operationIdOf(run, step),
        projectId: context.projectId,
        sourceId: fromId,
        targetId: toId,
        linkType: step.linkType,
      },
    );
    await scope.environment.imports.insertSource({
      projectId: context.projectId,
      sourceKey: step.key,
      targetKind: "dependency",
      targetId: completed.result.dependencyId,
      contentHash: context.hash,
      targetRevision: 0,
      resultJson: JSON.stringify(completed.result),
      lastRunId: run.id,
    });
    return {
      item: item(step, {
        action: "created",
        targetId: completed.result.dependencyId,
      }),
      completed,
    };
  }
}
