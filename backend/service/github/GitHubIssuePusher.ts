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

import {
  gitHubCreationKey,
  gitHubCreationMarker,
} from "./GitHubCreationIdentity";

import { applyTicketChange } from "@/backend/service/github/GitHubLocalChange";

import type { GitHubCreationRepository } from "@/backend/database/repositories/integrations/GitHubCreationRepository";
import type { GitHubChangeEvents } from "@/backend/service/github/GitHubLocalChange";
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
  private readonly creations: GitHubCreationRepository | undefined;
  private readonly events: GitHubChangeEvents;

  /**
   * Creates an issue pusher.
   *
   * @param taskRepository - Task persistence boundary storing the link state.
   * @param contextLoader - Resolver of the repository, token, and client.
   * @param now - Clock providing synchronization timestamps.
   * @param options - Durable identities that reconcile interrupted remote
   * creations, and the publisher the local changes store their events with.
   */
  public constructor(
    taskRepository: TaskRepository,
    contextLoader: GitHubSyncContextLoader,
    now: () => string,
    options: {
      readonly creations?: GitHubCreationRepository;
      readonly events: GitHubChangeEvents;
    },
  ) {
    this.taskRepository = taskRepository;
    this.contextLoader = contextLoader;
    this.now = now;
    this.creations = options.creations;
    this.events = options.events;
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
   * @param alsoApply - Further local writes of the same change, such as
   * clearing a resolved conflict; they commit with the link and the event.
   */
  public async pushLocalState(
    run: LinkedIssueRun,
    alsoApply?: () => Promise<void>,
  ): Promise<void> {
    const { sync, actor, item, issueNumber, remote, summary } = run;
    const patch = buildGitHubIssuePatch(item, remote);

    if (isEmptyGitHubIssuePatch(patch)) {
      // A refreshed baseline alone is bookkeeping and announces nothing.
      if (!alsoApply) {
        await this.refreshLinkBaseline(item, issueNumber, remote);
        return;
      }
      await applyTicketChange(this.events, item.id, async () => {
        await this.refreshLinkBaseline(item, issueNumber, remote);
        await alsoApply();
      });
      return;
    }

    const updated = await sync.client.updateIssue(
      sync.repo.owner,
      sync.repo.repo,
      issueNumber,
      patch,
    );

    await applyTicketChange(this.events, item.id, async () => {
      await this.taskRepository.updateGitHubLink(
        item.id,
        buildLinkFromPages(item, updated, this.now()),
      );
      await this.taskRepository.insertHistory(
        buildSyncHistoryEntry(actor.id, item.id, updated.number),
      );
      await alsoApply?.();
    });
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
    const remote = await this.createOrRecover(sync, item);
    // A recovered creation may predate a newer local edit; do not baseline unequal content.
    const patch = buildGitHubIssuePatch(item, remote);
    const created = isEmptyGitHubIssuePatch(patch)
      ? remote
      : await sync.client.updateIssue(
          sync.repo.owner,
          sync.repo.repo,
          remote.number,
          patch,
        );

    const timestamp = this.now();

    // The issue exists on GitHub now; link and history commit with the event.
    await applyTicketChange(this.events, item.id, async () => {
      await this.taskRepository.updateGitHubLink(
        item.id,
        buildLinkFromPages(
          item,
          {
            number: created.number,
            state: created.state,
            updatedAt: created.updatedAt,
            url: created.url,
          },
          timestamp,
        ),
      );
      await this.taskRepository.insertHistory(
        buildSyncHistoryEntry(actor.id, item.id, created.number),
      );
    });
    summary.created += 1;
  }

  private async createOrRecover(
    sync: GitHubSyncContext,
    item: WorkItemDetail,
  ): Promise<GitHubIssueData> {
    const { owner, repo } = sync.repo;
    if (!this.creations)
      return sync.client.createIssue(owner, repo, {
        title: item.title,
        body: item.description,
      });
    const key = gitHubCreationKey(`${owner}/${repo}`, item.id);
    const confirmed = await this.creations.find(key);
    if (confirmed !== null) return sync.client.getIssue(owner, repo, confirmed);
    const marker = gitHubCreationMarker(key);
    const existing = (await sync.client.listIssues(owner, repo, "all")).find(
      (issue) => issue.body.endsWith(marker),
    );
    if (existing) {
      await this.creations.confirm(key, existing.number);
      return existing;
    }
    if (!(await this.creations.begin(key)))
      throw new Error(
        "GitHub creation outcome is uncertain; reconcile the stored creation identity before retrying.",
      );
    const created = await sync.client.createIssue(owner, repo, {
      title: item.title,
      body: item.description + marker,
    });
    await this.creations.confirm(key, created.number);
    return created;
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
