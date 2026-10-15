import { ProjectPolicyService } from "@/backend/auth/ProjectPolicyService";
import {
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";

import { ProjectAccessService } from "./ProjectAccessService";

import type { ActorChannel } from "@/backend/auth/McpActorContext";
import type { ServerCache } from "@/backend/cache/ServerCache";
import type {
  ProjectDeletionDetails,
  ProjectRepository,
} from "@/backend/database/repositories/ProjectRepository";
import type { ProjectDeletionFiles } from "@/backend/database/repositories/project/ProjectDeletionFiles";
import type { ProjectDeletionScope } from "@/definition/AgentProjectDeletion";
import type { User } from "@/definition/User";

/**
 * What a deletion touches beyond the database.
 *
 * @remarks
 * Both effects belong to the process that runs the plans and keeps the files,
 * so the services receive them instead of reaching for those parts.
 */
export interface ProjectDeletionEffects {
  /** Stops the plan runs of the project and waits until they have closed. */
  stopRuns(projectId: string): Promise<void>;
  /** Removes the files whose rows a committed deletion removed. */
  removeFiles(files: ProjectDeletionFiles): Promise<void>;
}

/** The result of a committed deletion. */
export interface ProjectDeletionOutcome {
  /** What the project was and what went with it, as counted inside the deleting transaction. */
  readonly scope: ProjectDeletionScope;
  /** The people whose assignment to the project ended. */
  readonly memberIds: readonly string[];
  readonly files: ProjectDeletionFiles;
}

/**
 * Finishes a committed deletion: forgets the project in the cache and removes its files.
 *
 * @param cache - The shared server cache.
 * @param effects - Removes the files, when the process has a store for them.
 * @param projectId - The project that is gone.
 * @param files - The files whose rows the deletion removed.
 *
 * @remarks
 * The rows are gone for good by now, so a problem with a file is reported and
 * never turned into a failure; the sweeps remove what stays behind.
 */
export async function finishProjectDeletion(
  cache: ServerCache,
  effects: ProjectDeletionEffects | null,
  projectId: string,
  files: ProjectDeletionFiles,
): Promise<void> {
  cache.invalidateProject(projectId);
  cache.invalidateProjectMembership();
  cache.invalidateWorkItems();
  cache.invalidateLabels();
  cache.invalidateGitHub();
  cache.invalidatePrefix("project:", "statuses:");
  try {
    await effects?.removeFiles(files);
  } catch (error: unknown) {
    console.warn(
      "Pages could not remove the files of a deleted project.",
      error,
    );
  }
}

/**
 * The one authorized way to remove a project for good.
 *
 * @remarks
 * The interface and the MCP tool both end here, so the administrator check,
 * the scope check and the extent of the deletion cannot differ between them.
 * Every method decides afresh from the persisted account, inside the same
 * transaction in which it reads or deletes. Archived projects are deleted
 * like active ones.
 */
export class ProjectDeletionService {
  private readonly repository: ProjectRepository;
  private readonly cache: ServerCache;
  private readonly channel: ActorChannel;
  private readonly policy = new ProjectPolicyService();

  /**
   * Creates the service.
   *
   * @param repository - Project persistence; bound to a transaction when the caller holds one.
   * @param cache - Cache to invalidate once a deletion committed.
   * @param channel - Whether the administrator is read from the interface mode or from MCP eligibility.
   */
  public constructor(
    repository: ProjectRepository,
    cache: ServerCache,
    channel: ActorChannel = "ui",
  ) {
    this.repository = repository;
    this.cache = cache;
    this.channel = channel;
  }

  /**
   * Checks that the actor may delete the project, without reading or changing anything else.
   *
   * @param actor - The authenticated account.
   * @param projectId - The project to delete.
   * @throws {ProjectManagementDeniedError} When the actor is no administrator or the project is out of reach.
   * @throws {ProjectNotFoundError} When no such project exists.
   */
  public async authorize(actor: User, projectId: string): Promise<void> {
    await this.repository.transaction((repository) =>
      this.requireDeletable(repository, actor, projectId),
    );
  }

  /**
   * Describes the project and the data its deletion would remove.
   *
   * @param actor - The authenticated account.
   * @param projectId - The project to describe.
   * @returns The extent of the deletion.
   * @throws {ProjectManagementDeniedError} When the actor may not delete the project.
   * @throws {ProjectNotFoundError} When no such project exists.
   */
  public async describe(
    actor: User,
    projectId: string,
  ): Promise<ProjectDeletionDetails> {
    return this.repository.transaction(async (repository) => {
      await this.requireDeletable(repository, actor, projectId);
      const details = await repository.describeDeletion(projectId);
      if (!details) throw new ProjectNotFoundError();
      return details;
    });
  }

  /**
   * Deletes the project and everything that belongs to it in one transaction.
   *
   * @param actor - The authenticated account.
   * @param projectId - The project to delete.
   * @returns What went and which files are left to remove.
   * @throws {ProjectManagementDeniedError} When the actor may not delete the project.
   * @throws {ProjectNotFoundError} When no such project exists, such as after an earlier call.
   *
   * @remarks
   * The data goes or stays as a whole; a failure rolls everything back. The
   * caller removes the returned files after the commit and invalidates the
   * cache with {@link finishProjectDeletion}.
   */
  public async delete(
    actor: User,
    projectId: string,
  ): Promise<ProjectDeletionOutcome> {
    return this.repository.transaction(async (repository) => {
      await this.requireDeletable(repository, actor, projectId);
      const details = await repository.describeDeletion(projectId);
      if (!details) throw new ProjectNotFoundError();
      const files = await repository.deletePermanently(projectId);
      return { files, memberIds: details.memberIds, scope: details.scope };
    });
  }

  /**
   * Runs the deletion with the effects outside the database around it.
   *
   * @param actor - The authenticated account.
   * @param projectId - The project to delete.
   * @param effects - Stops runs before and removes files after the deletion.
   * @returns What went with the project.
   *
   * @remarks
   * Authorization comes first, so nobody else can stop runs. The runs are
   * stopped outside the deleting transaction because their own writes use the
   * shared connection. The deletion then decides again from fresh facts.
   */
  public async deleteWithEffects(
    actor: User,
    projectId: string,
    effects: ProjectDeletionEffects | null,
  ): Promise<ProjectDeletionOutcome> {
    await this.authorize(actor, projectId);
    await effects?.stopRuns(projectId);
    const outcome = await this.delete(actor, projectId);
    await finishProjectDeletion(this.cache, effects, projectId, outcome.files);
    return outcome;
  }

  private async requireDeletable(
    repository: ProjectRepository,
    actor: User,
    projectId: string,
  ): Promise<void> {
    const account = await new ProjectAccessService(
      repository,
      this.cache,
      this.channel,
    ).account(actor);
    // Ask about the administrator first, so a refusal says nothing about the project.
    if (!this.policy.canDelete(account))
      throw new ProjectManagementDeniedError();
    const project =
      (await repository.findById(projectId)) ??
      (await repository.findArchivedById(projectId));
    if (!project) throw new ProjectNotFoundError();
    if (
      !this.policy.canDeleteProject(
        account,
        project.departments.map((department) => department.id),
      )
    )
      throw new ProjectManagementDeniedError();
  }
}
