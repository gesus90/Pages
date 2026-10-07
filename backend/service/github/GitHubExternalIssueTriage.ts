import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";
import {
  buildLinkFromRemote,
  buildSyncHistoryEntry,
  buildWorkItemUpdateFromRemote,
  findOpenWorkflowStatus,
} from "@/backend/service/github/GitHubIssueMapping";
import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";

import type { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { GitHubSyncAccessGuard } from "@/backend/service/github/GitHubSyncAccessGuard";
import type { GitHubSyncContextLoader } from "@/backend/service/github/GitHubSyncContextLoader";
import type { TaskService } from "@/backend/service/TaskService";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

/** Dependencies required to triage detected external issues. */
export interface GitHubExternalIssueTriageOptions {
  readonly taskRepository: TaskRepository;
  readonly gitHubRepository: GitHubRepository;
  readonly taskService: TaskService;
  readonly accessGuard: GitHubSyncAccessGuard;
  readonly contextLoader: GitHubSyncContextLoader;
  readonly now: () => string;
}

/** Imports, links, or dismisses GitHub issues that have no Pages task yet. */
export class GitHubExternalIssueTriage {
  private readonly taskRepository: TaskRepository;
  private readonly gitHubRepository: GitHubRepository;
  private readonly taskService: TaskService;
  private readonly accessGuard: GitHubSyncAccessGuard;
  private readonly contextLoader: GitHubSyncContextLoader;
  private readonly now: () => string;

  /**
   * Creates an external issue triage.
   *
   * @param options - Repository, service, and infrastructure dependencies.
   */
  public constructor(options: GitHubExternalIssueTriageOptions) {
    this.taskRepository = options.taskRepository;
    this.gitHubRepository = options.gitHubRepository;
    this.taskService = options.taskService;
    this.accessGuard = options.accessGuard;
    this.contextLoader = options.contextLoader;
    this.now = options.now;
  }

  /**
   * Imports a detected external issue as a new Pages task and links both sides.
   *
   * @param actor - User importing the issue; must hold write permission.
   * @param projectId - Project receiving the new task.
   * @param issueNumber - Remote issue number to import.
   * @returns The created and linked task.
   */
  public async importIssue(
    actor: User,
    projectId: string,
    issueNumber: number,
  ): Promise<WorkItemDetail> {
    await this.accessGuard.requireWritableProject(actor, projectId);

    const external = await this.gitHubRepository.findExternalIssueByNumber(
      projectId,
      issueNumber,
    );

    if (
      !external ||
      external.dismissed ||
      external.importedWorkItemId ||
      (await this.isKnownLocalIssue(projectId, external.issueNumber))
    ) {
      throw new WorkItemValidationError("githubIssueNotImportable");
    }

    const sync = await this.contextLoader.requireContext(projectId);
    const remote = await sync.client.getIssue(
      sync.repo.owner,
      sync.repo.repo,
      external.issueNumber,
    );
    const statuses = (await this.taskRepository.findAllStatuses()).filter(
      (status) => status.projectId === null || status.projectId === projectId,
    );
    const openStatus = findOpenWorkflowStatus(statuses) ?? statuses[0];

    if (!openStatus) {
      throw new Error("No workflow status is available for imported tasks.");
    }

    const created = await this.taskService.create(actor, {
      description: remote.body,
      dueAt: null,
      milestoneId: null,
      parentId: null,
      priority: WORK_ITEM_PRIORITY.NORMAL,
      projectId,
      statusId: openStatus.id,
      title: remote.title,
      type: WORK_ITEM_TYPE.TASK,
      skipGitHubSync: true,
    });
    const timestamp = this.now();

    await this.taskRepository.updateGitHubLink(
      created.id,
      buildLinkFromRemote(remote, timestamp),
    );
    await this.gitHubRepository.markExternalIssueImported(
      external.id,
      created.id,
    );
    await this.taskRepository.insertHistory(
      buildSyncHistoryEntry(actor.id, created.id, remote.number),
    );

    const linked = await this.taskRepository.findById(
      created.id,
      await this.accessGuard.visibility(actor),
    );

    if (!linked) {
      throw new Error("Imported task could not be retrieved.");
    }

    return linked;
  }

  /**
   * Links a detected external issue to an existing task.
   *
   * @param actor - User linking the issue; must hold write permission.
   * @param workItemId - Task receiving the link.
   * @param externalId - Detected external issue to link.
   */
  public async linkIssue(
    actor: User,
    workItemId: string,
    externalId: string,
  ): Promise<WorkItemDetail> {
    const item = await this.accessGuard.requireWritableTask(actor, workItemId);

    if (item.type !== WORK_ITEM_TYPE.TASK) {
      throw new WorkItemValidationError("githubOnlyTasksLinkable");
    }

    if (item.githubIssueNumber !== null) {
      throw new WorkItemValidationError("githubTaskAlreadyLinked");
    }

    const external =
      await this.gitHubRepository.findExternalIssueById(externalId);

    if (
      !external ||
      external.projectId !== item.projectId ||
      external.dismissed ||
      external.importedWorkItemId ||
      (await this.isKnownLocalIssue(item.projectId, external.issueNumber))
    ) {
      throw new WorkItemValidationError("githubIssueNotLinkable");
    }

    const sync = await this.contextLoader.requireContext(item.projectId);
    const remote = await sync.client.getIssue(
      sync.repo.owner,
      sync.repo.repo,
      external.issueNumber,
    );
    const timestamp = this.now();

    await this.taskRepository.updateFromGitHub(
      item.id,
      buildWorkItemUpdateFromRemote(item, remote, item.statusId),
    );
    await this.taskRepository.updateGitHubLink(
      item.id,
      buildLinkFromRemote(remote, timestamp),
    );
    await this.gitHubRepository.markExternalIssueImported(external.id, item.id);
    await this.taskRepository.insertHistory(
      buildSyncHistoryEntry(actor.id, item.id, remote.number),
    );

    const linked = await this.taskRepository.findById(
      item.id,
      await this.accessGuard.visibility(actor),
    );

    if (!linked) {
      throw new Error("Linked task could not be retrieved.");
    }

    return linked;
  }

  /**
   * Hides a detected external issue without importing it.
   *
   * @param actor - User dismissing the issue; must hold write permission.
   * @param externalId - Detected external issue to dismiss.
   */
  public async dismissIssue(actor: User, externalId: string): Promise<void> {
    const external =
      await this.gitHubRepository.findExternalIssueById(externalId);

    if (!external) {
      throw new WorkItemValidationError("githubIssueNotDismissable");
    }

    await this.accessGuard.requireWritableProject(actor, external.projectId);
    await this.gitHubRepository.dismissExternalIssue(external.id);
  }
  private async isKnownLocalIssue(
    projectId: string,
    issueNumber: number,
  ): Promise<boolean> {
    return (
      await this.taskRepository.findKnownGitHubIssueNumbers(projectId)
    ).has(issueNumber);
  }
}
