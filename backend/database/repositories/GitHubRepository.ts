import {
  readBooleanColumn,
  readCountColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  GitHubExternalIssue,
  GitHubPullRequest,
} from "@/definition/GitHub";

/** Values required to persist a detected external GitHub issue. */
export interface NewGitHubExternalIssue {
  readonly id: string;
  readonly projectId: string;
  readonly issueNumber: number;
  readonly title: string;
  readonly url: string;
  readonly state: "open" | "closed";
}

/** Values that can change on a detected external GitHub issue. */
export interface GitHubExternalIssueUpdate {
  readonly title: string;
  readonly url: string;
  readonly state: "open" | "closed";
}

/** Values required to persist GitHub pull request metadata. */
export interface NewGitHubPullRequest {
  readonly id: string;
  readonly projectId: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "open" | "closed";
  readonly merged: boolean;
  readonly branch: string | null;
}

/** Values that can change on stored pull request metadata. */
export interface GitHubPullRequestUpdate {
  readonly title: string;
  readonly url: string;
  readonly state: "open" | "closed";
  readonly merged: boolean;
  readonly branch: string | null;
}

/** Establishes the persistence boundary for GitHub sync metadata. */
export class GitHubRepository {
  private readonly database: Database;

  /**
   * Creates a GitHub metadata repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /** Returns detected external issues of a project, newest first. */
  public async findExternalIssues(
    projectId: string,
    includeDismissed = false,
  ): Promise<GitHubExternalIssue[]> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            project_id,
            issue_number,
            title,
            url,
            state,
            dismissed,
            imported_work_item_id,
            detected_at,
            updated_at
        FROM github_external_issues
        WHERE project_id = $project_id
            AND ($include_dismissed = 1 OR dismissed = 0)
            AND imported_work_item_id IS NULL
        ORDER BY issue_number DESC;
      `,
      {
        project_id: projectId,
        include_dismissed: includeDismissed ? 1 : 0,
      },
    );

    return rows.map((row) => this.toExternalIssue(row));
  }

  /** Returns open external issues of several projects ordered by number. */
  public async findExternalIssuesByProjectIds(
    projectIds: readonly string[],
    includeDismissed = false,
  ): Promise<ReadonlyMap<string, readonly GitHubExternalIssue[]>> {
    const issuesByProject = new Map<string, GitHubExternalIssue[]>();

    if (projectIds.length === 0) {
      return issuesByProject;
    }

    const placeholders = projectIds
      .map((_, index) => `$issue_project_id_${index}`)
      .join(", ");
    const parameters: Record<string, string | number> = {
      include_dismissed: includeDismissed ? 1 : 0,
    };

    for (const [index, projectId] of projectIds.entries()) {
      parameters[`issue_project_id_${index}`] = projectId;
    }

    const rows = await this.database.query(
      `
        SELECT
            id,
            project_id,
            issue_number,
            title,
            url,
            state,
            dismissed,
            imported_work_item_id,
            detected_at,
            updated_at
        FROM github_external_issues
        WHERE project_id IN (${placeholders})
            AND ($include_dismissed = 1 OR dismissed = 0)
            AND imported_work_item_id IS NULL
        ORDER BY issue_number DESC;
      `,
      parameters,
    );

    for (const row of rows) {
      const issue = this.toExternalIssue(row);
      const assigned = issuesByProject.get(issue.projectId);

      if (assigned) {
        assigned.push(issue);
      } else {
        issuesByProject.set(issue.projectId, [issue]);
      }
    }

    return issuesByProject;
  }

  /** Returns a detected external issue by its identifier. */
  public async findExternalIssueById(
    id: string,
  ): Promise<GitHubExternalIssue | null> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            project_id,
            issue_number,
            title,
            url,
            state,
            dismissed,
            imported_work_item_id,
            detected_at,
            updated_at
        FROM github_external_issues
        WHERE id = $id;
      `,
      { id },
    );
    const row = rows[0];

    return row ? this.toExternalIssue(row) : null;
  }

  /** Returns a detected external issue by project and remote number. */
  public async findExternalIssueByNumber(
    projectId: string,
    issueNumber: number,
  ): Promise<GitHubExternalIssue | null> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            project_id,
            issue_number,
            title,
            url,
            state,
            dismissed,
            imported_work_item_id,
            detected_at,
            updated_at
        FROM github_external_issues
        WHERE project_id = $project_id
            AND issue_number = $issue_number;
      `,
      { project_id: projectId, issue_number: issueNumber },
    );
    const row = rows[0];

    return row ? this.toExternalIssue(row) : null;
  }

  /** Inserts a detected external issue or refreshes its remote metadata. */
  public async upsertExternalIssue(
    issue: NewGitHubExternalIssue,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO github_external_issues (
            id,
            project_id,
            issue_number,
            title,
            url,
            state,
            updated_at
        )
        VALUES (
            $id,
            $project_id,
            $issue_number,
            $title,
            $url,
            $state,
            CURRENT_TIMESTAMP
        )
        ON CONFLICT (project_id, issue_number) DO UPDATE SET
            title = excluded.title,
            url = excluded.url,
            state = excluded.state,
            updated_at = CURRENT_TIMESTAMP;
      `,
      {
        id: issue.id,
        project_id: issue.projectId,
        issue_number: issue.issueNumber,
        title: issue.title,
        url: issue.url,
        state: issue.state,
      },
    );
  }

  /** Updates the remote metadata of a detected external issue. */
  public async updateExternalIssue(
    id: string,
    issue: GitHubExternalIssueUpdate,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE github_external_issues
        SET
            title = $title,
            url = $url,
            state = $state,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $id;
      `,
      { id, title: issue.title, url: issue.url, state: issue.state },
    );
  }

  /** Hides a detected external issue without importing it. */
  public async dismissExternalIssue(id: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE github_external_issues
        SET
            dismissed = 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $id;
      `,
      { id },
    );
  }

  /** Marks a detected external issue as imported into the given work item. */
  public async markExternalIssueImported(
    id: string,
    workItemId: string,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE github_external_issues
        SET
            imported_work_item_id = $work_item_id,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $id;
      `,
      { id, work_item_id: workItemId },
    );
  }

  /** Removes the detection record of an imported or obsolete external issue. */
  public async deleteExternalIssue(id: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM github_external_issues
        WHERE id = $id;
      `,
      { id },
    );
  }

  /** Returns stored pull requests of a project, newest first. */
  public async findPullRequestsByProject(
    projectId: string,
  ): Promise<GitHubPullRequest[]> {
    const rows = await this.database.query(
      `
        SELECT
            github_pull_requests.id,
            github_pull_requests.project_id,
            github_pull_requests.number,
            github_pull_requests.title,
            github_pull_requests.url,
            github_pull_requests.state,
            github_pull_requests.merged,
            github_pull_requests.branch,
            github_pull_requests.work_item_id,
            work_items.key AS work_item_key,
            github_pull_requests.synced_at
        FROM github_pull_requests
        LEFT JOIN work_items
            ON work_items.id = github_pull_requests.work_item_id
        WHERE github_pull_requests.project_id = $project_id
        ORDER BY github_pull_requests.number DESC;
      `,
      { project_id: projectId },
    );

    return rows.map((row) => this.toPullRequest(row));
  }

  /** Returns the pull requests of several projects ordered by number. */
  public async findPullRequestsByProjectIds(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly GitHubPullRequest[]>> {
    const pullRequestsByProject = new Map<string, GitHubPullRequest[]>();

    if (projectIds.length === 0) {
      return pullRequestsByProject;
    }

    const placeholders = projectIds
      .map((_, index) => `$pull_request_project_id_${index}`)
      .join(", ");
    const parameters: Record<string, string> = {};

    for (const [index, projectId] of projectIds.entries()) {
      parameters[`pull_request_project_id_${index}`] = projectId;
    }

    const rows = await this.database.query(
      `
        SELECT
            github_pull_requests.id,
            github_pull_requests.project_id,
            github_pull_requests.number,
            github_pull_requests.title,
            github_pull_requests.url,
            github_pull_requests.state,
            github_pull_requests.merged,
            github_pull_requests.branch,
            github_pull_requests.work_item_id,
            work_items.key AS work_item_key,
            github_pull_requests.synced_at
        FROM github_pull_requests
        LEFT JOIN work_items
            ON work_items.id = github_pull_requests.work_item_id
        WHERE github_pull_requests.project_id IN (${placeholders})
        ORDER BY github_pull_requests.number DESC;
      `,
      parameters,
    );

    for (const row of rows) {
      const pullRequest = this.toPullRequest(row);
      const assigned = pullRequestsByProject.get(pullRequest.projectId);

      if (assigned) {
        assigned.push(pullRequest);
      } else {
        pullRequestsByProject.set(pullRequest.projectId, [pullRequest]);
      }
    }

    return pullRequestsByProject;
  }

  /** Returns the pull requests assigned to a work item. */
  public async findPullRequestsByWorkItem(
    workItemId: string,
  ): Promise<GitHubPullRequest[]> {
    const rows = await this.database.query(
      `
        SELECT
            github_pull_requests.id,
            github_pull_requests.project_id,
            github_pull_requests.number,
            github_pull_requests.title,
            github_pull_requests.url,
            github_pull_requests.state,
            github_pull_requests.merged,
            github_pull_requests.branch,
            github_pull_requests.work_item_id,
            work_items.key AS work_item_key,
            github_pull_requests.synced_at
        FROM github_pull_requests
        LEFT JOIN work_items
            ON work_items.id = github_pull_requests.work_item_id
        WHERE github_pull_requests.work_item_id = $work_item_id
        ORDER BY github_pull_requests.number DESC;
      `,
      { work_item_id: workItemId },
    );

    return rows.map((row) => this.toPullRequest(row));
  }

  /** Returns a stored pull request by its identifier. */
  public async findPullRequestById(
    id: string,
  ): Promise<GitHubPullRequest | null> {
    const rows = await this.database.query(
      `
        SELECT
            github_pull_requests.id,
            github_pull_requests.project_id,
            github_pull_requests.number,
            github_pull_requests.title,
            github_pull_requests.url,
            github_pull_requests.state,
            github_pull_requests.merged,
            github_pull_requests.branch,
            github_pull_requests.work_item_id,
            work_items.key AS work_item_key,
            github_pull_requests.synced_at
        FROM github_pull_requests
        LEFT JOIN work_items
            ON work_items.id = github_pull_requests.work_item_id
        WHERE github_pull_requests.id = $id;
      `,
      { id },
    );
    const row = rows[0];

    return row ? this.toPullRequest(row) : null;
  }

  /** Inserts pull request metadata or refreshes it while keeping assignments. */
  public async upsertPullRequest(
    pullRequest: NewGitHubPullRequest,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO github_pull_requests (
            id,
            project_id,
            number,
            title,
            url,
            state,
            merged,
            branch,
            synced_at
        )
        VALUES (
            $id,
            $project_id,
            $number,
            $title,
            $url,
            $state,
            $merged,
            $branch,
            CURRENT_TIMESTAMP
        )
        ON CONFLICT (project_id, number) DO UPDATE SET
            title = excluded.title,
            url = excluded.url,
            state = excluded.state,
            merged = excluded.merged,
            branch = excluded.branch,
            synced_at = CURRENT_TIMESTAMP;
      `,
      {
        id: pullRequest.id,
        project_id: pullRequest.projectId,
        number: pullRequest.number,
        title: pullRequest.title,
        url: pullRequest.url,
        state: pullRequest.state,
        merged: pullRequest.merged ? 1 : 0,
        branch: pullRequest.branch,
      },
    );
  }

  /** Assigns a pull request to a work item or clears its assignment. */
  public async assignPullRequest(
    id: string,
    workItemId: string | null,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE github_pull_requests
        SET
            work_item_id = $work_item_id,
            synced_at = CURRENT_TIMESTAMP
        WHERE id = $id;
      `,
      { id, work_item_id: workItemId },
    );
  }

  private toExternalIssue(row: readonly DatabaseValue[]): GitHubExternalIssue {
    const state = readTextColumn(row, 5, "state");
    const importedWorkItemId = row[7];

    if (state !== "open" && state !== "closed") {
      throw new Error(
        `Database returned an unsupported external issue state "${state}".`,
      );
    }

    if (importedWorkItemId !== null && typeof importedWorkItemId !== "string") {
      throw new Error(
        'Database returned an invalid value for "imported_work_item_id".',
      );
    }

    return {
      detectedAt: readTextColumn(row, 8, "detected_at"),
      dismissed: readBooleanColumn(row, 6, "dismissed"),
      id: readTextColumn(row, 0, "id"),
      importedWorkItemId,
      issueNumber: readCountColumn(row, 2, "issue_number"),
      projectId: readTextColumn(row, 1, "project_id"),
      state,
      title: readTextColumn(row, 3, "title"),
      updatedAt: readTextColumn(row, 9, "updated_at"),
      url: readTextColumn(row, 4, "url"),
    };
  }

  private toPullRequest(row: readonly DatabaseValue[]): GitHubPullRequest {
    const state = readTextColumn(row, 5, "state");
    const branch = row[7];
    const workItemId = row[8];
    const workItemKey = row[9];

    if (state !== "open" && state !== "closed") {
      throw new Error(
        `Database returned an unsupported pull request state "${state}".`,
      );
    }

    if (branch !== null && typeof branch !== "string") {
      throw new Error('Database returned an invalid value for "branch".');
    }

    if (workItemId !== null && typeof workItemId !== "string") {
      throw new Error('Database returned an invalid value for "work_item_id".');
    }

    if (workItemKey !== null && typeof workItemKey !== "string") {
      throw new Error(
        'Database returned an invalid value for "work_item_key".',
      );
    }

    return {
      branch,
      id: readTextColumn(row, 0, "id"),
      merged: readBooleanColumn(row, 6, "merged"),
      number: readCountColumn(row, 2, "number"),
      projectId: readTextColumn(row, 1, "project_id"),
      state,
      syncedAt: readTextColumn(row, 10, "synced_at"),
      title: readTextColumn(row, 3, "title"),
      url: readTextColumn(row, 4, "url"),
      workItemId,
      workItemKey,
    };
  }
}
