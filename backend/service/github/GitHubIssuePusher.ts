import {
  buildGitHubIssuePatch,
  buildLinkFromPages,
  buildSyncHistoryEntry,
  isEmptyGitHubIssuePatch,
} from "@/backend/service/github/GitHubIssueMapping";
import {
  canPushToGitHub,
  createEmptySyncCounters,
} from "@/backend/service/github/GitHubSyncRun";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { GitHubIssueData } from "@/backend/github/GitHubApiClient";
import type {
  GitHubSyncContext,
  GitHubSyncContextLoader,
} from "@/backend/service/github/GitHubSyncContextLoader";
import type {
  GitHubSyncCounters,
  LinkedIssueRun,
} from "@/backend/service/github/GitHubSyncRun";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

/** Pushes Pages tasks to GitHub issues. */
export class GitHubIssuePusher {
  private readonly taskRepository: TaskRepository;
  private readonly contextLoader: GitHubSyncContextLoader;
  private readonly now: () => string;

  /**
   * Creates an issue pusher.
   *
   * @param taskRepository - Task persistence boundary storing the link state.
   * @param contextLoader - Resolver of the repository, token, and client.
   * @param now - Clock providing synchronization timestamps.
   */
  public constructor(
    taskRepository: TaskRepository,
    contextLoader: GitHubSyncContextLoader,
    now: () => string,
  ) {
    this.taskRepository = taskRepository;
    this.contextLoader = contextLoader;
    this.now = now;
  }

  /**
   * Pushes one task to GitHub, creating the remote issue when missing.
   *
   * @param actor - User owning the change.
   * @param item - Fresh task detail after its Pages mutation.
   */
  public async publishTaskUpdate(
    actor: User,
    item: WorkItemDetail,
  ): Promise<void> {
    if (item.type !== WORK_ITEM_TYPE.TASK || item.githubConflict) {
      return;
    }

    const sync = await this.contextLoader.findContext(item.projectId);

    if (!sync || !canPushToGitHub(sync.integration)) {
      return;
    }

    if (item.githubIssueNumber === null) {
      if (!sync.integration.syncIssues) {
        return;
      }

      await this.createRemoteIssue(
        sync,
        actor,
        item,
        createEmptySyncCounters(),
      );
      return;
    }

    const remote = await sync.client.getIssue(
      sync.repo.owner,
      sync.repo.repo,
      item.githubIssueNumber,
    );

    await this.pushLocalState({
      actor,
      issueNumber: item.githubIssueNumber,
      item,
      remote,
      summary: createEmptySyncCounters(),
      sync,
    });
  }

  /**
   * Writes the differing task values to the linked issue.
   *
   * @param run - Task, its issue, and the counters of the current run.
   */
  public async pushLocalState(run: LinkedIssueRun): Promise<void> {
    const { sync, actor, item, issueNumber, remote, summary } = run;
    const patch = buildGitHubIssuePatch(item, remote);

    if (isEmptyGitHubIssuePatch(patch)) {
      await this.refreshLinkBaseline(item, issueNumber, remote);
      return;
    }

    const updated = await sync.client.updateIssue(
      sync.repo.owner,
      sync.repo.repo,
      issueNumber,
      patch,
    );

    await this.taskRepository.updateGitHubLink(
      item.id,
      buildLinkFromPages(item, updated, this.now()),
    );
    await this.taskRepository.insertHistory(
      buildSyncHistoryEntry(actor.id, item.id, updated.number),
    );
    summary.pushed += 1;
  }

  /**
   * Creates the GitHub issue of an unlinked task and links both sides.
   *
   * @param sync - Resolved repository, token, and client.
   * @param actor - User owning the change.
   * @param item - Task becoming an issue.
   * @param summary - Counters of the current run.
   */
  public async createRemoteIssue(
    sync: GitHubSyncContext,
    actor: User,
    item: WorkItemDetail,
    summary: GitHubSyncCounters,
  ): Promise<void> {
    const created = await sync.client.createIssue(
      sync.repo.owner,
      sync.repo.repo,
      { title: item.title, body: item.description },
    );

    if (item.isDone && created.state === "open") {
      await sync.client.updateIssue(
        sync.repo.owner,
        sync.repo.repo,
        created.number,
        { state: "closed" },
      );
    }

    const timestamp = this.now();
    const remoteState =
      item.isDone || created.state === "closed" ? "closed" : "open";

    await this.taskRepository.updateGitHubLink(
      item.id,
      buildLinkFromPages(
        item,
        {
          number: created.number,
          state: remoteState,
          updatedAt: created.updatedAt,
          url: created.url,
        },
        timestamp,
      ),
    );
    await this.taskRepository.insertHistory(
      buildSyncHistoryEntry(actor.id, item.id, created.number),
    );
    summary.created += 1;
  }

  private async refreshLinkBaseline(
    item: WorkItemDetail,
    issueNumber: number,
    remote: GitHubIssueData,
  ): Promise<void> {
    await this.taskRepository.updateGitHubLink(
      item.id,
      buildLinkFromPages(
        item,
        {
          number: issueNumber,
          state: remote.state,
          updatedAt: remote.updatedAt,
          url: item.githubIssueUrl,
        },
        this.now(),
      ),
    );
  }
}
