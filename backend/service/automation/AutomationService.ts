import { AutomationNotificationPreferenceRepository } from "@/backend/database/repositories/automation/AutomationNotificationPreferenceRepository";
import { AUTOMATION_NOTIFICATION_MODES } from "@/definition/Automation";
import { AutomationError } from "@/backend/error/AutomationError";

import { AutomationAccess } from "./AutomationAccess";
import { AutomationReads } from "./AutomationReads";
import { AutomationWrites } from "./AutomationWrites";

import type { Database } from "@/backend/database/Database";
import type {
  Automation,
  AutomationDeleted,
  AutomationDeletionScope,
  AutomationNotificationMode,
  AutomationOptions,
  AutomationPage,
  AutomationRunDetail,
  AutomationRunReceipt,
  AutomationRunSummary,
} from "@/definition/Automation";
import type { AutomationDirectory } from "./AutomationDirectory";

/** What the automation service is built from. */
export interface AutomationServiceDependencies {
  readonly database: Pick<Database, "query" | "execute" | "transaction">;
  readonly directory: AutomationDirectory;
  readonly now?: () => Date;
  /** Nudges the scheduler of this process after a manual run was queued. */
  readonly wake?: () => void;
}

/**
 * The business service of automations (PAGE-297).
 *
 * @remarks
 * The page, Pica, the agent tools and the HTTP API of the Pages MCP client
 * all call this service; none of them has a scheduler, a queue or a rule of
 * its own.
 */
export class AutomationService {
  private readonly access: AutomationAccess;
  private readonly reads: AutomationReads;
  private readonly writes: AutomationWrites;
  private readonly preferences: AutomationNotificationPreferenceRepository;
  private readonly now: () => Date;

  private readonly directory: AutomationDirectory;

  public constructor(dependencies: AutomationServiceDependencies) {
    this.directory = dependencies.directory;
    this.now = dependencies.now ?? ((): Date => new Date());
    this.access = new AutomationAccess(dependencies.directory);
    this.reads = new AutomationReads({
      database: dependencies.database,
      access: this.access,
      directory: dependencies.directory,
    });
    this.writes = new AutomationWrites({
      database: dependencies.database,
      access: this.access,
      reads: this.reads,
      now: this.now,
      wake: dependencies.wake,
    });
    this.preferences = new AutomationNotificationPreferenceRepository(
      dependencies.database,
    );
  }

  /** The rules, for the scheduler that checks them again before every run. */
  public get rules(): AutomationAccess {
    return this.access;
  }

  /** What the account may choose. */
  public async options(userId: string): Promise<AutomationOptions> {
    return this.reads.options(userId);
  }

  /** One page of visible automations. */
  public async list(
    userId: string,
    input: unknown,
  ): Promise<AutomationPage<Automation>> {
    return this.reads.list(userId, input);
  }

  /** One visible automation. */
  public async read(userId: string, input: unknown): Promise<Automation> {
    return this.reads.read(userId, input);
  }

  /** One page of runs of a visible automation. */
  public async runs(
    userId: string,
    input: unknown,
  ): Promise<AutomationPage<AutomationRunSummary>> {
    return this.reads.runs(userId, input);
  }

  /** One run of a visible automation. */
  public async run(
    userId: string,
    input: unknown,
  ): Promise<AutomationRunDetail> {
    return this.reads.run(userId, input);
  }

  /** The runs of every visible automation, newest first. */
  public async history(
    userId: string,
    input: { readonly cursor?: string | null; readonly limit?: number },
  ): Promise<AutomationPage<AutomationRunSummary>> {
    return this.reads.history(userId, input);
  }

  /** Creates an automation. */
  public async create(userId: string, input: unknown): Promise<Automation> {
    return this.writes.create(userId, input);
  }

  /** Patches an automation. */
  public async update(userId: string, input: unknown): Promise<Automation> {
    return this.writes.update(userId, input);
  }

  /** Switches an automation on or off. */
  public async setActive(userId: string, input: unknown): Promise<Automation> {
    return this.writes.setActive(userId, input);
  }

  /** Queues a manual run. */
  public async runNow(
    userId: string,
    input: unknown,
  ): Promise<AutomationRunReceipt> {
    return this.writes.run(userId, input);
  }

  /** Answers the scope of a deletion or deletes after confirmation. */
  public async delete(
    userId: string,
    input: unknown,
  ): Promise<AutomationDeletionScope | AutomationDeleted> {
    return this.writes.delete(userId, input);
  }

  /** Display names of projects and groups that automations are shared with. */
  public async sharingNames(): Promise<ReadonlyMap<string, string>> {
    return this.directory.sharingNames();
  }

  /** When the person hears about runs of their automations. */
  public async notificationMode(
    userId: string,
  ): Promise<AutomationNotificationMode> {
    return this.preferences.find(userId);
  }

  /**
   * Stores when the person hears about runs of their automations.
   *
   * @throws {AutomationError} `invalid_request` for an unknown mode.
   */
  public async setNotificationMode(
    userId: string,
    mode: unknown,
  ): Promise<AutomationNotificationMode> {
    const known = AUTOMATION_NOTIFICATION_MODES.find((value) => value === mode);
    if (!known)
      throw new AutomationError("invalid_request", { reason: "validation" });
    await this.access.actor(userId);
    await this.preferences.save(userId, known, this.now().toISOString());
    return known;
  }
}
