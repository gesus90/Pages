import { withReadScope } from "@/backend/database/ReadScope";
import { AgentError } from "@/backend/error/AgentErrors";
import { allRunAssetReferences } from "@/backend/agents/AgentPlanRunResources";

import { isPlanHistoryReadFailure } from "../AgentPlanControlAccess";
import {
  readAuthorizedPlanRun,
  findPlanRun,
  withClaudeRunUsage,
} from "../AgentPlanRunReader";
import { withRunCommand } from "../runs/RunCommandView";
import { hiddenContentFields, hideRunContent } from "./RunRedaction";

import type { AgentRunStarter } from "@/definition/AgentRunDiagnosis";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanRunResources } from "@/backend/agents/AgentPlanRunResources";
import type { PlanRunReadDependencies } from "../AgentPlanRunReader";
import type { HiddenContentSource } from "./RunRedaction";

/** Names the people who start runs; an account that is gone keeps its identifier. */
export interface RunStarterDirectory {
  displayName(userId: string): Promise<string | null>;
}

/** A run as one reader may see it. */
export interface ReadableRun {
  readonly run: AgentPlanRun;
  readonly startedBy: AgentRunStarter;
  /** Names of the fields left out because the reader may not see their content; empty when nothing is hidden. */
  readonly hiddenFields: readonly string[];
  readonly hiddenSources: readonly HiddenContentSource[];
}

async function isPermitted(check: () => Promise<void>): Promise<boolean> {
  try {
    await check();
    return true;
  } catch (error: unknown) {
    if (!isPlanHistoryReadFailure(error)) throw error;
    return false;
  }
}

/**
 * Reads runs for the whole team of a plan (PAGE-307).
 *
 * @remarks
 * Whoever may read a plan reads every run of it, whoever started the run.
 * What a run used of tickets, pages and workspaces stays protected: when the
 * reader may not see one of them, the run stays readable without any content
 * and says which fields are hidden. This reader only reads; stopping,
 * resuming and the other controls keep their own checks in the plan service.
 */
export class AgentPlanRunTeamReader {
  private readonly dependencies: PlanRunReadDependencies;
  private readonly starters: RunStarterDirectory;

  /**
   * Creates the reader.
   *
   * @param dependencies - Run storage and the checks every read of a run needs.
   * @param starters - Names the people who started runs.
   */
  public constructor(
    dependencies: PlanRunReadDependencies,
    starters: RunStarterDirectory,
  ) {
    this.dependencies = dependencies;
    this.starters = starters;
  }

  /**
   * Reads a run of a plan the reader may see.
   *
   * @param userId - The reader.
   * @param runId - The run.
   * @throws {AgentError} `plan_access_denied` for a missing run and for a run of a plan the reader may not see.
   */
  public async read(userId: string, runId: string): Promise<ReadableRun> {
    return withReadScope(async () => {
      const stored = await findPlanRun(this.dependencies, userId, runId);
      if (!stored) throw new AgentError("plan_access_denied");
      await this.dependencies.access.require(userId, stored.planId);
      const resources = await this.dependencies.runs.resources(runId);
      const hiddenSources = await this.hiddenSources(userId, stored, resources);
      const startedBy = await this.describeStarter(stored.userId);
      if (hiddenSources.length > 0) {
        const ticketSteps = new Set(
          hiddenSources.includes("tickets")
            ? Object.keys(resources.stepTickets ?? {})
            : [],
        );
        return {
          run: await this.withCommand(hideRunContent(stored, ticketSteps)),
          startedBy,
          hiddenFields: hiddenContentFields(ticketSteps),
          hiddenSources,
        };
      }
      return {
        run: await this.visibleRun(userId, stored),
        startedBy,
        hiddenFields: [],
        hiddenSources,
      };
    });
  }

  /**
   * Names a person who started a run.
   *
   * @param userId - The account that started the run.
   */
  public async describeStarter(userId: string): Promise<AgentRunStarter> {
    return {
      id: userId,
      displayName: (await this.starters.displayName(userId)) ?? userId,
    };
  }

  /** The starter reads their own run with their progress; everybody else reads the stored view. */
  private async visibleRun(
    userId: string,
    stored: AgentPlanRun,
  ): Promise<AgentPlanRun> {
    if (stored.userId === userId)
      try {
        return await readAuthorizedPlanRun(
          this.dependencies,
          userId,
          stored.id,
        );
      } catch (error: unknown) {
        // Model or remote access is no content; the stored view stays readable.
        if (!isPlanHistoryReadFailure(error)) throw error;
      }
    return this.withCommand(stored);
  }

  private async withCommand(run: AgentPlanRun): Promise<AgentPlanRun> {
    return withRunCommand(
      this.dependencies.engine,
      await withClaudeRunUsage(this.dependencies, run),
    );
  }

  private async hiddenSources(
    userId: string,
    run: AgentPlanRun,
    resources: AgentPlanRunResources,
  ): Promise<readonly HiddenContentSource[]> {
    const { tasks, parameters, workspaces, workspaceCatalog } =
      this.dependencies;
    const ticketAssets = allRunAssetReferences(run, resources.ticketAssets);
    const ticketIds = new Set([...resources.taskIds, ...resources.ticketIds]);
    const checks: readonly (readonly [
      HiddenContentSource,
      () => Promise<void>,
    ])[] = [
      [
        "tickets",
        async () => {
          for (const ticketId of ticketIds)
            await tasks.requireReadable(userId, ticketId);
          if (ticketAssets.length)
            await parameters.requireTicketAssets(userId, ticketAssets);
        },
      ],
      [
        "wiki",
        async () => {
          for (const pageId of resources.wikiIds)
            await parameters.requireWiki(userId, pageId);
        },
      ],
      [
        "workspaces",
        async () => {
          for (const workspaceId of resources.workspaceIds)
            await (workspaceCatalog ?? workspaces).requireAccess(
              userId,
              workspaceId,
              resources.projectId,
            );
        },
      ],
    ];
    const hidden: HiddenContentSource[] = [];
    for (const [source, check] of checks)
      if (!(await isPermitted(check))) hidden.push(source);
    return hidden;
  }
}
