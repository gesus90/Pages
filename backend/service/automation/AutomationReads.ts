import { AutomationAgentJobRepository } from "@/backend/database/repositories/automation/AutomationAgentJobRepository";
import { AutomationRepository } from "@/backend/database/repositories/automation/AutomationRepository";
import { AutomationRunRepository } from "@/backend/database/repositories/automation/AutomationRunRepository";
import { AutomationError } from "@/backend/error/AutomationError";
import {
  AUTOMATION_ANSWER_BYTES,
  AUTOMATION_EVENT_TYPES,
  AUTOMATION_FORWARD_OUTPUT_BYTES,
  AUTOMATION_INSTRUCTION_LENGTH,
  AUTOMATION_INTERVAL_SECONDS,
  AUTOMATION_LIST_LIMIT,
  AUTOMATION_NAME_LENGTH,
  AUTOMATION_RUN_RETENTION,
  AUTOMATION_TRIGGER_TYPES,
} from "@/definition/Automation";
import {
  AUTOMATION_ACTION_SCHEMA,
  AUTOMATION_NOTIFICATION_SCHEMA,
  AUTOMATION_SHARING_SCHEMA,
  AUTOMATION_TRIGGER_SCHEMA,
} from "@/definition/AgentTools/Automations";
import {
  PLAN_SCRIPT_BYTES,
  PLAN_SCRIPT_CONTENT_LENGTH,
  PLAN_SCRIPT_TIMEOUT,
} from "@/definition/AgentPlanScript";
import { USER_TIMEZONES } from "@/definition/Settings";

import { AUTOMATION_EVENT_EXAMPLES } from "./AutomationEventData";
import {
  decodeAutomationCursor,
  encodeAutomationCursor,
  listInputSchema,
  readAutomationInput,
  readInputSchema,
  runReadInputSchema,
  runsListInputSchema,
} from "./AutomationInput";
import {
  automationRunDetail,
  automationRunSummary,
  automationView,
} from "./AutomationViews";

import type { Database } from "@/backend/database/Database";
import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type {
  Automation,
  AutomationOptions,
  AutomationPage,
  AutomationPermissions,
  AutomationPlanChoice,
  AutomationRunDetail,
  AutomationRunSummary,
} from "@/definition/Automation";
import type { AutomationAccess } from "./AutomationAccess";
import type {
  AutomationAccount,
  AutomationDirectory,
} from "./AutomationDirectory";

/** Plans whose steps the options list at most. */
const PLAN_STEP_LIMIT = 100;
/** Visible automations a history page considers at most. */
const HISTORY_AUTOMATION_LIMIT = 1000;

/** What the reads are built from. */
export interface AutomationReadDependencies {
  readonly database: Pick<Database, "query" | "execute">;
  readonly access: AutomationAccess;
  readonly directory: AutomationDirectory;
}

/** A visible automation with the reader's permissions. */
export interface VisibleAutomation {
  readonly automation: StoredAutomation;
  readonly permissions: AutomationPermissions;
}

/**
 * Reads automations, their runs and the options of an account (PAGE-297).
 *
 * @remarks
 * Hidden and missing automations answer `not_found` alike; a reader never
 * sees script content or a script's output.
 */
export class AutomationReads {
  private readonly dependencies: AutomationReadDependencies;

  public constructor(dependencies: AutomationReadDependencies) {
    this.dependencies = dependencies;
  }

  /** What the account may choose; scripts only for active administrators. */
  public async options(userId: string): Promise<AutomationOptions> {
    const { access, directory } = this.dependencies;
    const actor = await access.actor(userId);
    const isAdministrator = actor.isAdministrator;
    const [agents, plans, projects, memberProjects, groups] = await Promise.all(
      [
        directory.agents(),
        this.planChoices(actor),
        directory.projects(actor.id),
        directory.memberProjects(actor.id),
        directory.groups(actor.id),
      ],
    );
    return {
      triggers: AUTOMATION_TRIGGER_TYPES.map((type) => ({
        type,
        isAllowed: true,
      })),
      actions: [
        { type: "agent", isAllowed: agents.length > 0 },
        { type: "script", isAllowed: isAdministrator },
        { type: "plan", isAllowed: plans.some((plan) => plan.canStart) },
      ],
      eventTypes: AUTOMATION_EVENT_TYPES,
      schemas: {
        trigger: AUTOMATION_TRIGGER_SCHEMA,
        action: AUTOMATION_ACTION_SCHEMA,
        sharing: AUTOMATION_SHARING_SCHEMA,
        agentNotification: AUTOMATION_NOTIFICATION_SCHEMA,
      },
      limits: {
        nameLength: AUTOMATION_NAME_LENGTH,
        instructionLength: AUTOMATION_INSTRUCTION_LENGTH,
        intervalSeconds: AUTOMATION_INTERVAL_SECONDS,
        answerBytes: AUTOMATION_ANSWER_BYTES,
        forwardOutputBytes: AUTOMATION_FORWARD_OUTPUT_BYTES,
        runRetention: AUTOMATION_RUN_RETENTION,
        list: AUTOMATION_LIST_LIMIT,
        script: {
          contentLength: PLAN_SCRIPT_CONTENT_LENGTH,
          timeoutSeconds: PLAN_SCRIPT_TIMEOUT,
          stdoutBytes: PLAN_SCRIPT_BYTES.stdout,
          stderrBytes: PLAN_SCRIPT_BYTES.stderr,
        },
      },
      timeZones: [...new Set([actor.timeZone, ...USER_TIMEZONES])],
      defaultTimeZone: actor.timeZone,
      agents,
      plans,
      projects,
      sharing: { projects: memberProjects, groups },
      workspaces: isAdministrator ? await directory.workspaces(actor.id) : [],
      interpreterProfiles: isAdministrator
        ? await directory.interpreterProfiles()
        : [],
      eventExamples: AUTOMATION_EVENT_EXAMPLES,
    };
  }

  /** One page of the automations the account can see. */
  public async list(
    userId: string,
    input: unknown,
  ): Promise<AutomationPage<Automation>> {
    const query = readAutomationInput(listInputSchema, input);
    const actor = await this.dependencies.access.actor(userId);
    const limit = query.limit ?? AUTOMATION_LIST_LIMIT.initial;
    const cursor = decodeAutomationCursor(query.cursor);
    const stored = await new AutomationRepository(
      this.dependencies.database,
    ).list({
      viewerId: actor.id,
      isAdministrator: actor.isAdministrator,
      text: query.text,
      isActive: query.isActive,
      after:
        cursor?.createdAt && cursor.id
          ? { createdAt: cursor.createdAt, id: cursor.id }
          : undefined,
      limit: limit + 1,
    });
    const page = stored.slice(0, limit);
    const items = await this.views(page, actor);
    const last = page.at(-1);
    return {
      items,
      nextCursor:
        stored.length > limit && last
          ? encodeAutomationCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }

  /**
   * Reads one visible automation.
   *
   * @throws {AutomationError} `not_found` for a missing or hidden one.
   */
  public async read(userId: string, input: unknown): Promise<Automation> {
    const { automationId } = readAutomationInput(readInputSchema, input);
    const actor = await this.dependencies.access.actor(userId);
    const visible = await this.requireVisible(automationId, actor);
    const [view] = await this.views([visible.automation], actor);
    if (!view) throw new AutomationError("not_found");
    return view;
  }

  /** One page of the runs of a visible automation, newest first. */
  public async runs(
    userId: string,
    input: unknown,
  ): Promise<AutomationPage<AutomationRunSummary>> {
    const query = readAutomationInput(runsListInputSchema, input);
    const actor = await this.dependencies.access.actor(userId);
    const { automation } = await this.requireVisible(query.automationId, actor);
    return this.runPage([automation], query);
  }

  /** The runs of every automation the account can see, newest first, for the history. */
  public async history(
    userId: string,
    input: { readonly cursor?: string | null; readonly limit?: number },
  ): Promise<AutomationPage<AutomationRunSummary>> {
    const actor = await this.dependencies.access.actor(userId);
    const automations = await new AutomationRepository(
      this.dependencies.database,
    ).list({
      viewerId: actor.id,
      isAdministrator: actor.isAdministrator,
      limit: HISTORY_AUTOMATION_LIMIT,
    });
    return this.runPage(automations, input);
  }

  /** One run of a visible automation with its bounded outputs. */
  public async run(
    userId: string,
    input: unknown,
  ): Promise<AutomationRunDetail> {
    const query = readAutomationInput(runReadInputSchema, input);
    const { access, database } = this.dependencies;
    const actor = await access.actor(userId);
    const { automation, permissions } = await this.requireVisible(
      query.automationId,
      actor,
    );
    const run = await new AutomationRunRepository(database).find(
      automation.id,
      query.runId,
    );
    if (!run) throw new AutomationError("not_found");
    const jobs = await new AutomationAgentJobRepository(database).forRuns([
      run.id,
    ]);
    return automationRunDetail(run, {
      automationName: automation.name,
      jobs,
      canSeeOutput: access.canSeeScript(automation, actor, permissions),
    });
  }

  /**
   * Reads a visible automation with the reader's permissions.
   *
   * @throws {AutomationError} `not_found` for a missing or hidden one.
   */
  public async requireVisible(
    automationId: string,
    actor: AutomationAccount,
  ): Promise<VisibleAutomation> {
    const automation = await new AutomationRepository(
      this.dependencies.database,
    ).find(automationId);
    if (!automation) throw new AutomationError("not_found");
    const permissions = await this.dependencies.access.permissions(
      automation,
      actor,
    );
    if (!permissions.canRead) throw new AutomationError("not_found");
    return { automation, permissions };
  }

  /** Builds the views of automations for one reader. */
  public async views(
    automations: readonly StoredAutomation[],
    actor: AutomationAccount,
  ): Promise<readonly Automation[]> {
    const { access, database } = this.dependencies;
    const latest = await new AutomationRunRepository(database).latest(
      automations.map((automation) => automation.id),
    );
    const creators = new Map<string, AutomationAccount | null>();
    const views: Automation[] = [];
    for (const automation of automations) {
      if (!creators.has(automation.creatorId))
        creators.set(
          automation.creatorId,
          await access.account(automation.creatorId),
        );
      const permissions = await access.permissions(automation, actor);
      views.push(
        automationView(automation, {
          creator: creators.get(automation.creatorId) ?? null,
          permissions,
          canSeeScript: access.canSeeScript(automation, actor, permissions),
          lastRun: latest.get(automation.id) ?? null,
        }),
      );
    }
    return views;
  }

  private async runPage(
    automations: readonly StoredAutomation[],
    input: { readonly cursor?: string | null; readonly limit?: number },
  ): Promise<AutomationPage<AutomationRunSummary>> {
    const limit = input.limit ?? AUTOMATION_LIST_LIMIT.initial;
    const cursor = decodeAutomationCursor(input.cursor);
    const names = new Map(
      automations.map((automation) => [automation.id, automation.name]),
    );
    const runs = await new AutomationRunRepository(
      this.dependencies.database,
    ).list({
      automationIds: [...names.keys()],
      beforeSequence: cursor?.sequence ?? null,
      limit: limit + 1,
    });
    const page = runs.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((run) =>
        automationRunSummary(run, names.get(run.automationId) ?? ""),
      ),
      nextCursor:
        runs.length > limit && last
          ? encodeAutomationCursor({ sequence: last.sequence })
          : null,
    };
  }

  private async planChoices(
    actor: AutomationAccount,
  ): Promise<readonly AutomationPlanChoice[]> {
    const { directory } = this.dependencies;
    const plans = await directory.plans(actor.id);
    const choices: AutomationPlanChoice[] = [];
    for (const [index, plan] of plans.entries()) {
      const steps =
        index < PLAN_STEP_LIMIT
          ? await directory.planSteps(actor.id, plan.id)
          : null;
      choices.push({ ...plan, steps: steps ?? [] });
    }
    return choices;
  }
}
