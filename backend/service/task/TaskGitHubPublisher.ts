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
   * @param actor - User owning the change.
   * @param item - Fresh work item detail after its Pages mutation.
   */
  public async publish(actor: User, item: WorkItemDetail): Promise<void> {
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
      await this.recordFailure(actor, item, error);
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

    console.error(
      `Pages could not publish task "${item.key}" to GitHub.`,
      error,
    );

    if (item.githubLastError === message) {
      return;
    }

    await this.taskRepository.setGitHubError(item.id, message);
    this.cache.invalidateWorkItems();
    await this.history.recordGitHubSyncFailed(actor, item.id, message);
  }
}
