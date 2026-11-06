import { keepForCallCommit } from "@/backend/database/CallTransaction";
import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { databaseFailureFacts } from "@/backend/logging/LogError";
import { logEvent } from "@/backend/logging/Logger";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { GitHubSyncService } from "@/backend/service/GitHubSyncService";
import type { TaskHistoryRecorder } from "@/backend/service/task/TaskHistoryRecorder";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

const MAXIMUM_ERROR_MESSAGE_LENGTH = 200;

/** Publishes work item changes to GitHub on a best-effort basis. */
export class TaskGitHubPublisher {
  private readonly taskRepository: TaskRepository;
  private readonly history: TaskHistoryRecorder;
  private readonly cache: ServerCache;
  private gitHubSync: GitHubSyncService | null = null;

  /**
   * Creates a GitHub publisher.
   *
   * @param taskRepository - Task persistence boundary.
   * @param history - Audit trail receiving failed publications.
   * @param cache - Shared server cache invalidated when the error state changes.
   */
  public constructor(
    taskRepository: TaskRepository,
    history: TaskHistoryRecorder,
    cache: ServerCache,
  ) {
    this.taskRepository = taskRepository;
    this.history = history;
    this.cache = cache;
  }

  /**
   * Attaches the GitHub synchronization used for best-effort outbound updates.
   *
   * @param gitHubSync - Synchronization service publishing task changes.
   */
  public attach(gitHubSync: GitHubSyncService): void {
    this.gitHubSync = gitHubSync;
  }

  /**
   * Publishes a mutated task to GitHub without failing the Pages mutation.
   *
   * @param actor - User owning the change; the publication keeps their rights.
   * @param item - Fresh work item detail after its Pages mutation.
   * @returns Once the publication ended; it never rejects, so callers may
   * start it without waiting.
   *
   * @remarks
   * The change already committed when this starts, so it outlives the request
   * as background work (PAGE-199): a client that left neither cancels it nor
   * shortens its database budget.
   */
  public publish(actor: User, item: WorkItemDetail): Promise<void> {
    const start = (): Promise<void> =>
      withBackgroundDatabaseWork("github_publish", () =>
        this.publishCommitted(actor, item),
      );
    // Inside an announced call the change is committed only when the call ends.
    if (
      keepForCallCommit(async () => {
        void start();
      })
    )
      return Promise.resolve();
    return start();
  }

  private async publishCommitted(
    actor: User,
    item: WorkItemDetail,
  ): Promise<void> {
    if (!this.gitHubSync) {
      return;
    }

    try {
      await this.gitHubSync.publishTaskUpdate(actor, item);

      if (item.githubLastError !== null) {
        await this.taskRepository.setGitHubError(item.id, null);
        this.cache.invalidateWorkItems();
      }
    } catch (error: unknown) {
      await this.reportFailure(actor, item, error);
    }
  }

  /**
   * Keeps a failed publication visible on the ticket as far as the database allows.
   *
   * @remarks
   * The database may refuse the same write it refused a moment ago. That only
   * loses the error state of the ticket, never the committed change, so it ends
   * here in the log instead of as an unhandled rejection.
   */
  private async reportFailure(
    actor: User,
    item: WorkItemDetail,
    error: unknown,
  ): Promise<void> {
    logEvent({
      level: "error",
      event: "task.github_publish.failed",
      component: "TaskGitHubPublisher",
      message: "The committed ticket change was not published to GitHub",
      error,
      metadata: { ticketId: item.id, ...databaseFailureFacts(error) },
    });
    try {
      await this.recordFailure(actor, item, error);
    } catch (recordingError: unknown) {
      logEvent({
        level: "error",
        event: "task.github_publish.failure_not_recorded",
        component: "TaskGitHubPublisher",
        message:
          "The failed publication could not be stored on the ticket; its committed change stays",
        error: recordingError,
        metadata: {
          ticketId: item.id,
          ...databaseFailureFacts(recordingError),
        },
      });
    }
  }

  private async recordFailure(
    actor: User,
    item: WorkItemDetail,
    error: unknown,
  ): Promise<void> {
    const message =
      error instanceof Error
        ? error.message.slice(0, MAXIMUM_ERROR_MESSAGE_LENGTH)
        : "GitHub synchronization failed.";

    if (item.githubLastError === message) {
      return;
    }

    await this.taskRepository.setGitHubError(item.id, message);
    this.cache.invalidateWorkItems();
    await this.history.recordGitHubSyncFailed(actor, item.id, message);
  }
}
