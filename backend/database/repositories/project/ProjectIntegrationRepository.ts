import { readBooleanColumn, readTextColumn } from "@/backend/database/RowValue";
import { isGitHubSyncInterval } from "@/definition/Project";

import type {
  Database,
  DatabaseValue,
  SqlParameters,
} from "@/backend/database/Database";
import type {
  GitHubSyncInterval,
  ProjectIntegration,
} from "@/definition/Project";

/** Values stored for the GitHub integration without exposing the secret. */
export interface NewProjectIntegration {
  readonly repoUrl: string;
  readonly tokenHash: string | null;
  readonly tokenEncrypted: string | null;
  readonly syncIssues: boolean;
  readonly syncStatus: boolean;
  readonly syncComments: boolean;
  readonly syncPullRequests: boolean;
  readonly syncCommits: boolean;
  readonly syncDirection: "bidirectional" | "push" | "pull";
  readonly syncIntervalMinutes: GitHubSyncInterval;
  readonly isConnected: boolean;
  readonly repoName: string | null;
  readonly lastSyncAt: string | null;
}

/** A project whose scheduled GitHub synchronization is due. */
export interface DueGitHubSync {
  readonly projectId: string;
  readonly ownerId: string;
}

/** Timestamps of the last and the next scheduled synchronization run. */
export interface ProjectSyncSchedule {
  readonly lastSyncAt: string | null;
  readonly nextSyncAt: string | null;
}

const INTEGRATION_COLUMNS = `
    project_id,
    repo_url,
    has_token,
    sync_issues,
    sync_status,
    sync_comments,
    sync_pull_requests,
    sync_commits,
    sync_direction,
    sync_interval_minutes,
    is_connected,
    repo_name,
    last_sync_at,
    next_sync_at,
    updated_at
`;

function toFlag(isEnabled: boolean): 0 | 1 {
  return isEnabled ? 1 : 0;
}

/** Binds the settings shared by the insert and the update statement. */
function toSettingParameters(
  projectId: string,
  integration: NewProjectIntegration,
): SqlParameters {
  return {
    project_id: projectId,
    repo_url: integration.repoUrl,
    token_hash: integration.tokenHash,
    token_encrypted: integration.tokenEncrypted,
    sync_issues: toFlag(integration.syncIssues),
    sync_status: toFlag(integration.syncStatus),
    sync_comments: toFlag(integration.syncComments),
    sync_pull_requests: toFlag(integration.syncPullRequests),
    sync_commits: toFlag(integration.syncCommits),
    sync_direction: integration.syncDirection,
    sync_interval_minutes: integration.syncIntervalMinutes,
    is_connected: toFlag(integration.isConnected),
    repo_name: integration.repoName,
    last_sync_at: integration.lastSyncAt,
  };
}

function toProjectIntegration(
  row: readonly DatabaseValue[],
): ProjectIntegration {
  const interval = row[9];
  const repoName = row[11];
  const lastSyncAt = row[12];
  const nextSyncAt = row[13];
  const direction = readTextColumn(row, 8, "sync_direction");

  if (typeof interval !== "number" || !isGitHubSyncInterval(interval)) {
    throw new Error(
      'Database returned an invalid value for "sync_interval_minutes".',
    );
  }

  if (repoName !== null && typeof repoName !== "string") {
    throw new Error('Database returned an invalid value for "repo_name".');
  }

  if (lastSyncAt !== null && typeof lastSyncAt !== "string") {
    throw new Error('Database returned an invalid value for "last_sync_at".');
  }

  if (nextSyncAt !== null && typeof nextSyncAt !== "string") {
    throw new Error('Database returned an invalid value for "next_sync_at".');
  }

  return {
    projectId: readTextColumn(row, 0, "project_id"),
    repoUrl: readTextColumn(row, 1, "repo_url"),
    hasToken: readBooleanColumn(row, 2, "has_token"),
    syncIssues: readBooleanColumn(row, 3, "sync_issues"),
    syncStatus: readBooleanColumn(row, 4, "sync_status"),
    syncComments: readBooleanColumn(row, 5, "sync_comments"),
    syncPullRequests: readBooleanColumn(row, 6, "sync_pull_requests"),
    syncCommits: readBooleanColumn(row, 7, "sync_commits"),
    syncDirection:
      direction === "push" || direction === "pull"
        ? direction
        : "bidirectional",
    syncIntervalMinutes: interval,
    isConnected: readBooleanColumn(row, 10, "is_connected"),
    repoName,
    lastSyncAt,
    nextSyncAt,
    updatedAt: readTextColumn(row, 14, "updated_at"),
  };
}

/** Owns persistence operations for the GitHub integration of a project. */
export class ProjectIntegrationRepository {
  private readonly database: Database;

  /**
   * Creates a project integration repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /** Returns the sanitized GitHub integration settings for a project. */
  public async findByProjectId(
    projectId: string,
  ): Promise<ProjectIntegration | null> {
    const rows = await this.database.query(
      `
        SELECT
            ${INTEGRATION_COLUMNS}
        FROM project_integrations
        WHERE project_id = $project_id;
      `,
      { project_id: projectId },
    );
    const row = rows[0];

    return row ? toProjectIntegration(row) : null;
  }

  /** Returns the sanitized GitHub integration settings of several projects. */
  public async findByProjectIds(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProjectIntegration>> {
    const integrationsByProject = new Map<string, ProjectIntegration>();

    if (projectIds.length === 0) {
      return integrationsByProject;
    }

    const placeholders = projectIds
      .map((_, index) => `$integration_project_id_${index}`)
      .join(", ");
    const parameters: Record<string, string> = {};

    for (const [index, projectId] of projectIds.entries()) {
      parameters[`integration_project_id_${index}`] = projectId;
    }

    const rows = await this.database.query(
      `
        SELECT
            ${INTEGRATION_COLUMNS}
        FROM project_integrations
        WHERE project_id IN (${placeholders});
      `,
      parameters,
    );

    for (const row of rows) {
      integrationsByProject.set(
        readTextColumn(row, 0, "project_id"),
        toProjectIntegration(row),
      );
    }

    return integrationsByProject;
  }

  /**
   * Returns the encrypted GitHub token for server-side API calls.
   *
   * @param projectId - Project the integration belongs to.
   * @returns The encrypted token, or `null` when none is stored.
   *
   * @remarks
   * The result must never leave the server: routes and services only
   * expose the `hasToken` indicator to the browser.
   */
  public async findTokenEncrypted(projectId: string): Promise<string | null> {
    const rows = await this.database.query(
      `
        SELECT
            token_encrypted
        FROM project_integrations
        WHERE project_id = $project_id;
      `,
      { project_id: projectId },
    );
    const row = rows[0];

    if (!row || row[0] === null) {
      return null;
    }

    return readTextColumn(row, 0, "token_encrypted");
  }

  /** Returns integrations with a due scheduled synchronization run. */
  public async findDueSyncs(nowIso: string): Promise<DueGitHubSync[]> {
    const rows = await this.database.query(
      `
        SELECT
            project_integrations.project_id,
            projects.owner_id
        FROM project_integrations
        INNER JOIN projects
            ON projects.id = project_integrations.project_id
        WHERE project_integrations.is_connected = 1
            AND project_integrations.has_token = 1
            AND project_integrations.sync_interval_minutes > 0
            AND (
                project_integrations.next_sync_at IS NULL
                OR project_integrations.next_sync_at <= $now
            )
            AND projects.archived_at IS NULL;
      `,
      { now: nowIso },
    );

    return rows.map((row) => ({
      ownerId: readTextColumn(row, 1, "owner_id"),
      projectId: readTextColumn(row, 0, "project_id"),
    }));
  }

  /** Records the synchronization timestamps of a project integration. */
  public async updateSyncSchedule(
    projectId: string,
    schedule: ProjectSyncSchedule,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE project_integrations
        SET
            last_sync_at = $last_sync_at,
            next_sync_at = $next_sync_at,
            updated_at = utc_now()
        WHERE project_id = $project_id;
      `,
      {
        project_id: projectId,
        last_sync_at: schedule.lastSyncAt,
        next_sync_at: schedule.nextSyncAt,
      },
    );
  }

  /**
   * Creates or replaces the integration settings without ever returning the secret.
   *
   * @param projectId - Project the integration belongs to.
   * @param integration - Sanitized settings; a `null` token hash keeps the stored secret.
   */
  public async upsert(
    projectId: string,
    integration: NewProjectIntegration,
  ): Promise<void> {
    const existing = await this.findByProjectId(projectId);

    if (!existing) {
      await this.insert(projectId, integration);

      return;
    }

    await this.update(projectId, integration, existing);
  }

  /** Removes the integration settings including the stored secret hash. */
  public async delete(projectId: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM project_integrations
        WHERE project_id = $project_id;
      `,
      { project_id: projectId },
    );
  }

  private async insert(
    projectId: string,
    integration: NewProjectIntegration,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO project_integrations (
            project_id,
            repo_url,
            token_hash,
            token_encrypted,
            has_token,
            sync_issues,
            sync_status,
            sync_comments,
            sync_pull_requests,
            sync_commits,
            sync_direction,
            sync_interval_minutes,
            is_connected,
            repo_name,
            last_sync_at,
            updated_at
        )
        VALUES (
            $project_id,
            $repo_url,
            $token_hash,
            $token_encrypted,
            $has_token,
            $sync_issues,
            $sync_status,
            $sync_comments,
            $sync_pull_requests,
            $sync_commits,
            $sync_direction,
            $sync_interval_minutes,
            $is_connected,
            $repo_name,
            $last_sync_at,
            utc_now()
        );
      `,
      {
        ...toSettingParameters(projectId, integration),
        has_token: toFlag(Boolean(integration.tokenHash)),
      },
    );
  }

  private async update(
    projectId: string,
    integration: NewProjectIntegration,
    existing: ProjectIntegration,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE project_integrations
        SET
            repo_url = $repo_url,
            token_hash = COALESCE($token_hash, token_hash),
            token_encrypted = COALESCE($token_encrypted, token_encrypted),
            has_token = CASE
                WHEN $token_hash IS NOT NULL THEN 1
                WHEN $clear_token = 1 THEN 0
                ELSE has_token
            END,
            sync_issues = $sync_issues,
            sync_status = $sync_status,
            sync_comments = $sync_comments,
            sync_pull_requests = $sync_pull_requests,
            sync_commits = $sync_commits,
            sync_direction = $sync_direction,
            sync_interval_minutes = $sync_interval_minutes,
            is_connected = $is_connected,
            repo_name = $repo_name,
            last_sync_at = $last_sync_at,
            updated_at = utc_now()
        WHERE project_id = $project_id;
      `,
      {
        ...toSettingParameters(projectId, integration),
        clear_token: toFlag(
          integration.tokenHash === null && !existing.hasToken,
        ),
      },
    );
  }
}
