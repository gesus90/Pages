import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { logEvent } from "@/backend/logging/Logger";
import { recordServiceProgress } from "@/backend/runtime/ServiceWorkHealth";

import { canProcessIntegrations } from "./IntegrationProcessing";
import { gitHubJobErrorCode } from "./GitHubJobErrors";

import type {
  GitHubJob,
  GitHubJobRepository,
} from "@/backend/database/repositories/integrations/GitHubJobRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { TaskService } from "@/backend/service/TaskService";
import type { GitHubSyncService } from "@/backend/service/GitHubSyncService";
import type { GitHubJobResult } from "@/definition/IntegrationJobs";

/** Only the elected consumer uses the unrouted GitHub facade. */
export interface GitHubJobWorkerDependencies {
  readonly jobs: GitHubJobRepository;
  readonly github: GitHubSyncService;
  readonly users: UserRepository;
  readonly tasks: TaskService;
}

/** Serial durable GitHub execution; periodic and request-triggered work share the same queue. */
export class GitHubJobWorker {
  private readonly dependencies: GitHubJobWorkerDependencies;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private nextScheduledAt = 0;
  private nextPollAt = 0;
  private isStopped = false;

  /** Builds a worker without starting a timer or touching credentials. */
  public constructor(dependencies: GitHubJobWorkerDependencies) {
    this.dependencies = dependencies;
  }

  /** Recovers the previous owner's interrupted jobs, then polls the shared queue. */
  public async start(): Promise<void> {
    if (!canProcessIntegrations() || this.timer !== null) return;
    await this.dependencies.jobs.recover();
    this.timer = setInterval(() => this.kick(), 250);
    this.timer.unref();
    this.kick();
  }

  /** Stops taking work and drains the current operation before ownership can be released. */
  public async stop(): Promise<void> {
    this.isStopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    await this.running;
  }

  private kick(): void {
    if (
      this.isStopped ||
      this.running ||
      !canProcessIntegrations() ||
      Date.now() < this.nextPollAt
    )
      return;
    this.running = withBackgroundDatabaseWork("integration_github", () =>
      this.pass(),
    );
  }

  private async pass(): Promise<void> {
    try {
      if (Date.now() >= this.nextScheduledAt) {
        await this.dependencies.jobs.enqueue(
          { operation: "scheduled" },
          "scheduled",
        );
        this.nextScheduledAt = Date.now() + 60_000;
        await this.dependencies.jobs.prune();
      }
      const job = await this.dependencies.jobs.claim();
      recordServiceProgress("integrations.github");
      if (job) await this.deliver(job);
      recordServiceProgress("integrations.github");
    } catch {
      this.nextPollAt = Date.now() + 5_000;
      logEvent({
        level: "error",
        event: "integrations.github.poll_failed",
        component: "GitHubJobWorker",
        message: "GitHub queue processing failed; pending work remains stored",
      });
    } finally {
      this.running = null;
    }
  }

  private async deliver(job: GitHubJob): Promise<void> {
    try {
      const result = await this.execute(job);
      await this.dependencies.jobs.finish(job.id, result);
    } catch (error: unknown) {
      const code = gitHubJobErrorCode(error);
      if (code || job.attempts >= 6 || job.command.operation === "import") {
        await this.dependencies.jobs.finish(job.id, {
          kind: "error",
          code: code ?? "integration_failed",
        });
      } else {
        await this.dependencies.jobs.retry(
          job.id,
          Math.min(3600, 30 * 2 ** (job.attempts - 1)),
        );
      }
      logEvent({
        level: "warn",
        event: "integrations.github.delivery_failed",
        component: "GitHubJobWorker",
        message: "GitHub operation did not complete; inspect its durable state",
        metadata: { jobId: job.id },
      });
    }
  }

  private async execute(job: GitHubJob): Promise<GitHubJobResult> {
    const { github, tasks, users } = this.dependencies;
    const command = job.command;
    if (command.operation === "scheduled") {
      const scheduled = await github.runScheduledSyncs();
      return {
        kind: "scheduled",
        completed: scheduled.completed,
        failed: scheduled.failed,
      };
    }
    const actor = await users.findById(command.actorId);
    if (!actor?.isActive) return { kind: "error", code: "project_access" };
    switch (command.operation) {
      case "project":
        return {
          kind: "summary",
          summary: await github.syncProjectNow(actor, command.targetId),
        };
      case "single":
        return {
          kind: "summary",
          summary: await github.syncSingleTask(actor, command.targetId),
        };
      case "publish":
        await github.publishTaskUpdate(
          actor,
          await tasks.getById(actor, command.targetId),
        );
        return { kind: "void" };
      case "test":
        return {
          kind: "boolean",
          result: await github.testConnection(actor, command.targetId),
        };
      case "import":
        return {
          kind: "task",
          id: (
            await github.importExternalIssue(
              actor,
              command.targetId,
              command.issueNumber,
            )
          ).id,
        };
      case "link":
        return {
          kind: "task",
          id: (
            await github.linkExternalIssue(
              actor,
              command.targetId,
              command.externalId,
            )
          ).id,
        };
      case "resolve":
        return {
          kind: "task",
          id: (
            await github.resolveConflict(
              actor,
              command.targetId,
              command.resolution,
            )
          ).id,
        };
    }
  }
}
