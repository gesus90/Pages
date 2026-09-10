import {
  readBlobColumn,
  readBooleanColumn,
  readCountColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import {
  isGitHubSyncInterval,
  isProjectRole,
  isProjectStatus,
} from "@/definition/Project";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  GitHubSyncInterval,
  Project,
  ProjectActivity,
  ProjectActivityCategory,
  ProjectEvent,
  ProjectGoal,
  ProjectIntegration,
  ProjectMember,
  ProjectRole,
  ProjectStatus,
} from "@/definition/Project";

/** Values required to persist a new project. */
export interface NewProject {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly ownerId: string;
  readonly placeholderColor: string;
  readonly status: ProjectStatus;
}

/** Values that can be changed after a project is created. */
export interface ProjectUpdate {
  readonly name: string;
  readonly description: string;
  readonly status: ProjectStatus;
  readonly progress: number;
}

/** Extended values editable on the project detail page. */
export interface ProjectDetailsUpdate extends ProjectUpdate {
  readonly managerId: string | null;
  readonly startDate: string | null;
  readonly targetDate: string | null;
  readonly notes: string;
}

/** Stored icon metadata and binary image content. */
export interface ProjectIcon {
  readonly mimeType: string;
  readonly filename: string;
  readonly data: Buffer;
}

/** Values required to persist a project goal. */
export interface NewProjectGoal {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly position: number;
}

/** Values required to persist a project planning date. */
export interface NewProjectEvent {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly eventDate: string;
  readonly eventTime: string | null;
  readonly type: string;
}

/** Values that can be changed on a project planning date. */
export interface ProjectEventUpdate {
  readonly title: string;
  readonly description: string;
  readonly eventDate: string;
  readonly eventTime: string | null;
  readonly type: string;
}

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

/** Entry recorded in the chronological project activity log. */
export interface NewProjectActivity {
  readonly id: string;
  readonly projectId: string;
  readonly userId: string;
  readonly category: ProjectActivityCategory;
  readonly action: string;
  readonly message: string;
}

const PROJECT_COLUMNS = `
    projects.id,
    projects.parent_id,
    projects.name,
    COALESCE(projects.description, ''),
    projects.status,
    projects.progress,
    projects.placeholder_color,
    EXISTS (
        SELECT 1
        FROM project_icons
        WHERE project_icons.project_id = projects.id
    ),
    projects.manager_id,
    manager.display_name,
    projects.start_date,
    projects.target_date,
    COALESCE(projects.notes, ''),
    projects.created_at,
    projects.updated_at
`;

const PROJECT_JOIN_MANAGER = `
    LEFT JOIN users AS manager
        ON manager.id = projects.manager_id
`;

/** Establishes the persistence boundary for projects. */
export class ProjectRepository {
  private readonly database: Database;

  /**
   * Creates a project repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /** Returns every non-archived project ordered by most recent change. */
  public async findAll(): Promise<Project[]> {
    const rows = await this.database.query(`
      SELECT
          ${PROJECT_COLUMNS}
      FROM projects
      ${PROJECT_JOIN_MANAGER}
      WHERE projects.archived_at IS NULL
      ORDER BY projects.updated_at DESC, projects.name;
    `);

    return rows.map((row) => this.toProject(row));
  }

  /** Returns the non-archived projects that include the given member. */
  public async findByMemberId(memberId: string): Promise<Project[]> {
    const rows = await this.database.query(
      `
        SELECT
            ${PROJECT_COLUMNS}
        FROM projects
        ${PROJECT_JOIN_MANAGER}
        INNER JOIN project_members
            ON project_members.project_id = projects.id
        WHERE project_members.user_id = $member_id
            AND projects.archived_at IS NULL
        ORDER BY projects.updated_at DESC, projects.name;
      `,
      { member_id: memberId },
    );

    return rows.map((row) => this.toProject(row));
  }

  /** Returns a non-archived project by identifier. */
  public async findById(id: string): Promise<Project | null> {
    const rows = await this.database.query(
      `
        SELECT
            ${PROJECT_COLUMNS}
        FROM projects
        ${PROJECT_JOIN_MANAGER}
        WHERE projects.id = $id
            AND projects.archived_at IS NULL;
      `,
      { id },
    );

    const row = rows[0];

    return row ? this.toProject(row) : null;
  }

  /** Returns whether the user belongs to the project. */
  public async isMember(projectId: string, userId: string): Promise<boolean> {
    const rows = await this.database.query(
      `
        SELECT
            COUNT(*)
        FROM project_members
        WHERE project_id = $project_id
            AND user_id = $user_id;
      `,
      { project_id: projectId, user_id: userId },
    );
    const row = rows[0];

    if (!row) {
      throw new Error("Database returned no membership count.");
    }

    return readCountColumn(row, 0, "member_count") > 0;
  }

  /** Returns whether the user holds the project manager role in the project. */
  public async isProjectManager(
    projectId: string,
    userId: string,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        SELECT
            COUNT(*)
        FROM project_members
        WHERE project_id = $project_id
            AND user_id = $user_id
            AND role = 'manager';
      `,
      { project_id: projectId, user_id: userId },
    );
    const row = rows[0];

    if (!row) {
      throw new Error("Database returned no manager count.");
    }

    return readCountColumn(row, 0, "manager_count") > 0;
  }

  /** Inserts a project and its owner membership. */
  public async insert(project: NewProject): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO projects (
            id,
            parent_id,
            name,
            description,
            owner_id,
            status,
            progress,
            placeholder_color,
            updated_at
        )
        VALUES (
            $id,
            NULL,
            $name,
            $description,
            $owner_id,
            $status,
            0,
            $placeholder_color,
            CURRENT_TIMESTAMP
        );
      `,
      {
        id: project.id,
        name: project.name,
        description: project.description,
        owner_id: project.ownerId,
        status: project.status,
        placeholder_color: project.placeholderColor,
      },
    );
    await this.database.execute(
      `
        INSERT INTO project_members (
            project_id,
            user_id,
            role
        )
        VALUES (
            $project_id,
            $user_id,
            'manager'
        );
      `,
      { project_id: project.id, user_id: project.ownerId },
    );
  }

  /** Updates the editable values of a non-archived project. */
  public async update(id: string, project: ProjectUpdate): Promise<void> {
    await this.database.execute(
      `
        UPDATE projects
        SET
            name = $name,
            description = $description,
            status = $status,
            progress = $progress,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      {
        id,
        name: project.name,
        description: project.description,
        status: project.status,
        progress: project.progress,
      },
    );
  }

  /** Updates the extended detail values of a non-archived project. */
  public async updateDetails(
    id: string,
    project: ProjectDetailsUpdate,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE projects
        SET
            name = $name,
            description = $description,
            status = $status,
            progress = $progress,
            manager_id = $manager_id,
            start_date = $start_date,
            target_date = $target_date,
            notes = $notes,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      {
        id,
        name: project.name,
        description: project.description,
        status: project.status,
        progress: project.progress,
        manager_id: project.managerId,
        start_date: project.startDate,
        target_date: project.targetDate,
        notes: project.notes,
      },
    );
  }

  /** Marks a project as archived without deleting persisted data. */
  public async archive(id: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE projects
        SET
            archived_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      { id },
    );
  }

  /** Returns the custom icon attached to a project. */
  public async findIconByProjectId(
    projectId: string,
  ): Promise<ProjectIcon | null> {
    const rows = await this.database.query(
      `
        SELECT
            mime_type,
            filename,
            data
        FROM project_icons
        WHERE project_id = $project_id;
      `,
      { project_id: projectId },
    );
    const row = rows[0];

    if (!row) {
      return null;
    }

    return {
      data: readBlobColumn(row, 2, "data"),
      filename: readTextColumn(row, 1, "filename"),
      mimeType: readTextColumn(row, 0, "mime_type"),
    };
  }

  /** Creates or replaces the custom icon attached to a project. */
  public async upsertIcon(projectId: string, icon: ProjectIcon): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO project_icons (
            project_id,
            mime_type,
            filename,
            data,
            updated_at
        )
        VALUES (
            $project_id,
            $mime_type,
            $filename,
            $data,
            CURRENT_TIMESTAMP
        )
        ON CONFLICT (project_id) DO UPDATE SET
            mime_type = excluded.mime_type,
            filename = excluded.filename,
            data = excluded.data,
            updated_at = CURRENT_TIMESTAMP;
      `,
      {
        project_id: projectId,
        mime_type: icon.mimeType,
        filename: icon.filename,
        data: icon.data,
      },
    );
  }

  /** Returns every person assigned to the project with their project role. */
  public async findMembers(projectId: string): Promise<ProjectMember[]> {
    const rows = await this.database.query(
      `
        SELECT
            users.id,
            users.username,
            users.display_name,
            project_members.role,
            project_members.joined_at,
            users.is_active
        FROM project_members
        INNER JOIN users
            ON users.id = project_members.user_id
        WHERE project_members.project_id = $project_id
        ORDER BY
            CASE project_members.role
                WHEN 'manager' THEN 0
                WHEN 'member' THEN 1
                ELSE 2
            END,
            users.display_name ASC;
      `,
      { project_id: projectId },
    );

    return rows.map((row) => this.toProjectMember(row));
  }

  /** Adds a person to the project with the given project role. */
  public async addMember(
    projectId: string,
    userId: string,
    role: ProjectRole,
    joinedAt?: string,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO project_members (
            project_id,
            user_id,
            role,
            joined_at
        )
        VALUES (
            $project_id,
            $user_id,
            $role,
            COALESCE($joined_at, CURRENT_TIMESTAMP)
        )
        ON CONFLICT (project_id, user_id) DO UPDATE SET
            role = excluded.role;
      `,
      {
        joined_at: joinedAt ?? null,
        project_id: projectId,
        user_id: userId,
        role,
      },
    );
  }

  /** Changes the project role of an assigned person. */
  public async updateMemberRole(
    projectId: string,
    userId: string,
    role: ProjectRole,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE project_members
        SET
            role = $role
        WHERE project_id = $project_id
            AND user_id = $user_id;
      `,
      { project_id: projectId, user_id: userId, role },
    );
  }

  /** Removes a person from the project. */
  public async removeMember(projectId: string, userId: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM project_members
        WHERE project_id = $project_id
            AND user_id = $user_id;
      `,
      { project_id: projectId, user_id: userId },
    );
  }

  /** Returns the goals of a project ordered by position. */
  public async findGoals(projectId: string): Promise<ProjectGoal[]> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            project_id,
            title,
            is_done,
            position
        FROM project_goals
        WHERE project_id = $project_id
        ORDER BY position ASC, created_at ASC;
      `,
      { project_id: projectId },
    );

    return rows.map((row) => this.toProjectGoal(row));
  }

  /** Inserts a goal for the project. */
  public async insertGoal(goal: NewProjectGoal): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO project_goals (
            id,
            project_id,
            title,
            is_done,
            position
        )
        VALUES (
            $id,
            $project_id,
            $title,
            0,
            $position
        );
      `,
      {
        id: goal.id,
        project_id: goal.projectId,
        title: goal.title,
        position: goal.position,
      },
    );
  }

  /** Updates the title and completion state of a goal. */
  public async updateGoal(
    id: string,
    title: string,
    isDone: boolean,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE project_goals
        SET
            title = $title,
            is_done = $is_done
        WHERE id = $id;
      `,
      { id, title, is_done: isDone ? 1 : 0 },
    );
  }

  /** Deletes a goal. */
  public async deleteGoal(id: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM project_goals
        WHERE id = $id;
      `,
      { id },
    );
  }

  /** Returns the tags assigned to the project. */
  public async findTags(projectId: string): Promise<string[]> {
    const rows = await this.database.query(
      `
        SELECT
            tag
        FROM project_tags
        WHERE project_id = $project_id
        ORDER BY tag ASC;
      `,
      { project_id: projectId },
    );

    return rows.map((row) => readTextColumn(row, 0, "tag"));
  }

  /** Replaces all tags assigned to the project. */
  public async setTags(
    projectId: string,
    tags: readonly string[],
  ): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM project_tags
        WHERE project_id = $project_id;
      `,
      { project_id: projectId },
    );

    for (const tag of tags) {
      await this.database.execute(
        `
          INSERT INTO project_tags (
              project_id,
              tag
          )
          VALUES (
              $project_id,
              $tag
          )
          ON CONFLICT (project_id, tag) DO NOTHING;
        `,
        { project_id: projectId, tag },
      );
    }
  }

  /** Returns the non-archived planning dates of a project. */
  public async findEvents(projectId: string): Promise<ProjectEvent[]> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            project_id,
            title,
            COALESCE(description, ''),
            event_date,
            event_time,
            type,
            created_at,
            updated_at
        FROM project_events
        WHERE project_id = $project_id
            AND archived_at IS NULL
        ORDER BY event_date ASC, event_time ASC;
      `,
      { project_id: projectId },
    );

    return rows.map((row) => this.toProjectEvent(row));
  }

  /** Inserts a planning date for the project. */
  public async insertEvent(event: NewProjectEvent): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO project_events (
            id,
            project_id,
            title,
            description,
            event_date,
            event_time,
            type,
            updated_at
        )
        VALUES (
            $id,
            $project_id,
            $title,
            $description,
            $event_date,
            $event_time,
            $type,
            CURRENT_TIMESTAMP
        );
      `,
      {
        id: event.id,
        project_id: event.projectId,
        title: event.title,
        description: event.description,
        event_date: event.eventDate,
        event_time: event.eventTime,
        type: event.type,
      },
    );
  }

  /** Updates a planning date. */
  public async updateEvent(
    id: string,
    event: ProjectEventUpdate,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE project_events
        SET
            title = $title,
            description = $description,
            event_date = $event_date,
            event_time = $event_time,
            type = $type,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      {
        id,
        title: event.title,
        description: event.description,
        event_date: event.eventDate,
        event_time: event.eventTime,
        type: event.type,
      },
    );
  }

  /** Archives a planning date without deleting it. */
  public async archiveEvent(id: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE project_events
        SET
            archived_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      { id },
    );
  }

  /** Returns the sanitized GitHub integration settings for a project. */
  public async findIntegration(
    projectId: string,
  ): Promise<ProjectIntegration | null> {
    const rows = await this.database.query(
      `
        SELECT
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
        FROM project_integrations
        WHERE project_id = $project_id;
      `,
      { project_id: projectId },
    );
    const row = rows[0];

    return row ? this.toProjectIntegration(row) : null;
  }

  /** Returns the sanitized GitHub integration settings of several projects. */
  public async findIntegrationsByProjectIds(
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
        FROM project_integrations
        WHERE project_id IN (${placeholders});
      `,
      parameters,
    );

    for (const row of rows) {
      integrationsByProject.set(
        readTextColumn(row, 0, "project_id"),
        this.toProjectIntegration(row),
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
  public async findDueSyncIntegrations(
    nowIso: string,
  ): Promise<DueGitHubSync[]> {
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
    schedule: {
      readonly lastSyncAt: string | null;
      readonly nextSyncAt: string | null;
    },
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE project_integrations
        SET
            last_sync_at = $last_sync_at,
            next_sync_at = $next_sync_at,
            updated_at = CURRENT_TIMESTAMP
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
  public async upsertIntegration(
    projectId: string,
    integration: NewProjectIntegration,
  ): Promise<void> {
    const existing = await this.findIntegration(projectId);

    if (!existing) {
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
              CURRENT_TIMESTAMP
          );
        `,
        {
          project_id: projectId,
          repo_url: integration.repoUrl,
          token_hash: integration.tokenHash,
          token_encrypted: integration.tokenEncrypted,
          has_token: integration.tokenHash ? 1 : 0,
          sync_issues: integration.syncIssues ? 1 : 0,
          sync_status: integration.syncStatus ? 1 : 0,
          sync_comments: integration.syncComments ? 1 : 0,
          sync_pull_requests: integration.syncPullRequests ? 1 : 0,
          sync_commits: integration.syncCommits ? 1 : 0,
          sync_direction: integration.syncDirection,
          sync_interval_minutes: integration.syncIntervalMinutes,
          is_connected: integration.isConnected ? 1 : 0,
          repo_name: integration.repoName,
          last_sync_at: integration.lastSyncAt,
        },
      );

      return;
    }

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
            updated_at = CURRENT_TIMESTAMP
        WHERE project_id = $project_id;
      `,
      {
        project_id: projectId,
        repo_url: integration.repoUrl,
        token_hash: integration.tokenHash,
        token_encrypted: integration.tokenEncrypted,
        clear_token:
          integration.tokenHash === null && !existing.hasToken ? 1 : 0,
        sync_issues: integration.syncIssues ? 1 : 0,
        sync_status: integration.syncStatus ? 1 : 0,
        sync_comments: integration.syncComments ? 1 : 0,
        sync_pull_requests: integration.syncPullRequests ? 1 : 0,
        sync_commits: integration.syncCommits ? 1 : 0,
        sync_direction: integration.syncDirection,
        sync_interval_minutes: integration.syncIntervalMinutes,
        is_connected: integration.isConnected ? 1 : 0,
        repo_name: integration.repoName,
        last_sync_at: integration.lastSyncAt,
      },
    );
  }

  /** Removes the integration settings including the stored secret hash. */
  public async deleteIntegration(projectId: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM project_integrations
        WHERE project_id = $project_id;
      `,
      { project_id: projectId },
    );
  }

  /** Returns the chronological activity log of a project, newest last. */
  public async findActivity(projectId: string): Promise<ProjectActivity[]> {
    const rows = await this.database.query(
      `
        SELECT
            project_activity.id,
            project_activity.project_id,
            project_activity.user_id,
            users.display_name,
            project_activity.category,
            project_activity.action,
            project_activity.message,
            project_activity.created_at
        FROM project_activity
        LEFT JOIN users
            ON users.id = project_activity.user_id
        WHERE project_activity.project_id = $project_id
        ORDER BY project_activity.created_at ASC;
      `,
      { project_id: projectId },
    );

    return rows.map((row) => this.toProjectActivity(row));
  }

  /** Records an entry in the chronological project activity log. */
  public async insertActivity(entry: NewProjectActivity): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO project_activity (
            id,
            project_id,
            user_id,
            category,
            action,
            message,
            created_at
        )
        VALUES (
            $id,
            $project_id,
            $user_id,
            $category,
            $action,
            $message,
            CURRENT_TIMESTAMP
        );
      `,
      {
        id: entry.id,
        project_id: entry.projectId,
        user_id: entry.userId,
        category: entry.category,
        action: entry.action,
        message: entry.message,
      },
    );
  }

  private toProject(row: readonly DatabaseValue[]): Project {
    const parentId = row[1];

    if (parentId !== null && typeof parentId !== "string") {
      throw new Error('Database returned an invalid value for "parent_id".');
    }

    const progress = readCountColumn(row, 5, "progress");
    const status = readTextColumn(row, 4, "status");

    if (!isProjectStatus(status)) {
      throw new Error(
        `Database returned an unsupported project status "${status}".`,
      );
    }

    if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
      throw new Error('Database returned an invalid value for "progress".');
    }

    const managerId = row[8];
    const managerName = row[9];
    const startDate = row[10];
    const targetDate = row[11];

    if (managerId !== null && typeof managerId !== "string") {
      throw new Error('Database returned an invalid value for "manager_id".');
    }

    if (managerName !== null && typeof managerName !== "string") {
      throw new Error('Database returned an invalid value for "manager_name".');
    }

    if (startDate !== null && typeof startDate !== "string") {
      throw new Error('Database returned an invalid value for "start_date".');
    }

    if (targetDate !== null && typeof targetDate !== "string") {
      throw new Error('Database returned an invalid value for "target_date".');
    }

    return {
      id: readTextColumn(row, 0, "id"),
      parentId,
      name: readTextColumn(row, 2, "name"),
      description: readTextColumn(row, 3, "description"),
      status,
      progress,
      placeholderColor: readTextColumn(row, 6, "placeholder_color"),
      hasIcon: readBooleanColumn(row, 7, "has_icon"),
      managerId,
      managerName,
      startDate,
      targetDate,
      notes: readTextColumn(row, 12, "notes"),
      createdAt: readTextColumn(row, 13, "created_at"),
      updatedAt: readTextColumn(row, 14, "updated_at"),
    };
  }

  private toProjectMember(row: readonly DatabaseValue[]): ProjectMember {
    const role = readTextColumn(row, 3, "role");

    if (!isProjectRole(role)) {
      throw new Error(
        `Database returned an unsupported project role "${role}".`,
      );
    }

    return {
      userId: readTextColumn(row, 0, "user_id"),
      username: readTextColumn(row, 1, "username"),
      displayName: readTextColumn(row, 2, "display_name"),
      projectRole: role,
      joinedAt: readTextColumn(row, 4, "joined_at"),
      isActive: readBooleanColumn(row, 5, "is_active"),
    };
  }

  private toProjectGoal(row: readonly DatabaseValue[]): ProjectGoal {
    return {
      id: readTextColumn(row, 0, "id"),
      projectId: readTextColumn(row, 1, "project_id"),
      title: readTextColumn(row, 2, "title"),
      isDone: readBooleanColumn(row, 3, "is_done"),
      position: readCountColumn(row, 4, "position"),
    };
  }

  private toProjectEvent(row: readonly DatabaseValue[]): ProjectEvent {
    const eventTime = row[5];

    if (eventTime !== null && typeof eventTime !== "string") {
      throw new Error('Database returned an invalid value for "event_time".');
    }

    return {
      id: readTextColumn(row, 0, "id"),
      projectId: readTextColumn(row, 1, "project_id"),
      title: readTextColumn(row, 2, "title"),
      description: readTextColumn(row, 3, "description"),
      eventDate: readTextColumn(row, 4, "event_date"),
      eventTime,
      type: readTextColumn(row, 6, "type"),
      createdAt: readTextColumn(row, 7, "created_at"),
      updatedAt: readTextColumn(row, 8, "updated_at"),
    };
  }

  private toProjectIntegration(
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

  private toProjectActivity(row: readonly DatabaseValue[]): ProjectActivity {
    const userDisplayName = row[3];

    if (userDisplayName !== null && typeof userDisplayName !== "string") {
      throw new Error(
        'Database returned an invalid value for "user_display_name".',
      );
    }

    return {
      id: readTextColumn(row, 0, "id"),
      projectId: readTextColumn(row, 1, "project_id"),
      userId: readTextColumn(row, 2, "user_id"),
      userDisplayName,
      category: readTextColumn(row, 4, "category") as ProjectActivityCategory,
      action: readTextColumn(row, 5, "action"),
      message: readTextColumn(row, 6, "message"),
      createdAt: readTextColumn(row, 7, "created_at"),
    };
  }
}
