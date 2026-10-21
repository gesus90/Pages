import {
  readBooleanColumn,
  readCountColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import {
  hasAllCounts,
  PROJECT_DELETION_COUNT_KEYS,
  PROJECT_DELETION_DETACHMENT_KEYS,
} from "@/definition/AgentProjectDeletion";

import { findReleasedBoardPreferences } from "./ProjectReferenceCleanup";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type {
  ProjectDeletionCountKey,
  ProjectDeletionCounts,
  ProjectDeletionDetachmentKey,
  ProjectDeletionDetachments,
} from "@/definition/AgentProjectDeletion";

const WORK_ITEMS = "SELECT id FROM work_items WHERE project_id = $project_id";
const MILESTONES = "SELECT id FROM milestones WHERE project_id = $project_id";
const WIKI_PAGES = "SELECT id FROM wiki_pages WHERE project_id = $project_id";
const PLAN_RUNS = `
  SELECT id
  FROM agent_plan_runs
  WHERE project_id = $project_id
      OR plan_id IN (SELECT id FROM agent_plans WHERE project_id = $project_id)
`;

/** One count query per kind of data; every statement returns a single number. */
const COUNT_STATEMENTS: Readonly<Record<ProjectDeletionCountKey, string>> = {
  tickets: "SELECT COUNT(*) FROM work_items WHERE project_id = $project_id;",
  subtickets: `
    SELECT COUNT(*)
    FROM work_items
    WHERE project_id = $project_id
        AND parent_id IS NOT NULL;
  `,
  ticketAttachments: `
    SELECT COUNT(*)
    FROM work_item_attachments
    WHERE work_item_id IN (${WORK_ITEMS});
  `,
  ticketChecklistItems: `
    SELECT COUNT(*)
    FROM work_item_checklist_items
    WHERE work_item_id IN (${WORK_ITEMS});
  `,
  ticketLinks: `
    SELECT COUNT(*)
    FROM work_item_links
    WHERE work_item_id IN (${WORK_ITEMS})
        OR linked_work_item_id IN (${WORK_ITEMS});
  `,
  ticketHistoryEntries: `
    SELECT COUNT(*)
    FROM work_item_history
    WHERE work_item_id IN (${WORK_ITEMS});
  `,
  milestones: "SELECT COUNT(*) FROM milestones WHERE project_id = $project_id;",
  milestoneDependencies: `
    SELECT COUNT(*)
    FROM milestone_dependencies
    WHERE project_id = $project_id
        OR source_id IN (${MILESTONES})
        OR target_id IN (${MILESTONES});
  `,
  wikiPages: "SELECT COUNT(*) FROM wiki_pages WHERE project_id = $project_id;",
  wikiComments: `
    SELECT COUNT(*)
    FROM wiki_comments
    WHERE page_id IN (${WIKI_PAGES});
  `,
  wikiAttachments: `
    SELECT COUNT(*)
    FROM wiki_attachments
    WHERE page_id IN (${WIKI_PAGES});
  `,
  plans: "SELECT COUNT(*) FROM agent_plans WHERE project_id = $project_id;",
  planRuns: `SELECT COUNT(*) FROM (${PLAN_RUNS}) AS plan_runs;`,
  workspaces: `
    SELECT
        (SELECT COUNT(*) FROM agent_workspaces WHERE project_id = $project_id)
        + (SELECT COUNT(*) FROM remote_workspaces WHERE project_id = $project_id);
  `,
  importRuns: `
    SELECT COUNT(*)
    FROM agent_import_runs
    WHERE project_id = $project_id;
  `,
  importSources: `
    SELECT COUNT(*)
    FROM agent_import_sources
    WHERE project_id = $project_id;
  `,
  members: `
    SELECT COUNT(*)
    FROM project_members
    WHERE project_id = $project_id;
  `,
  departmentAssignments: `
    SELECT COUNT(*)
    FROM project_departments
    WHERE project_id = $project_id;
  `,
  goals: "SELECT COUNT(*) FROM project_goals WHERE project_id = $project_id;",
  events: "SELECT COUNT(*) FROM project_events WHERE project_id = $project_id;",
  activityEntries: `
    SELECT COUNT(*)
    FROM project_activity
    WHERE project_id = $project_id;
  `,
  githubRecords: `
    SELECT
        (SELECT COUNT(*) FROM github_pull_requests WHERE project_id = $project_id)
        + (SELECT COUNT(*) FROM github_external_issues WHERE project_id = $project_id);
  `,
  integrations: `
    SELECT
        (SELECT COUNT(*) FROM project_integrations WHERE project_id = $project_id)
        + (SELECT COUNT(*) FROM project_discord_connections WHERE project_id = $project_id);
  `,
  templates: `
    SELECT COUNT(*)
    FROM project_templates
    WHERE project_id = $project_id;
  `,
};

/** The references elsewhere that a deletion clears; the saved board filters are counted separately. */
const DETACHMENT_STATEMENTS: Readonly<
  Record<Exclude<ProjectDeletionDetachmentKey, "boardPreferences">, string>
> = {
  templateAssignments: `
    SELECT COUNT(*)
    FROM work_item_template_projects
    WHERE project_id = $project_id;
  `,
  wikiAnchors: `
    SELECT COUNT(*)
    FROM wiki_page_anchors
    WHERE page_id NOT IN (${WIKI_PAGES})
        AND (
            (kind = 'milestone' AND target_id IN (${MILESTONES}))
            OR (kind = 'epic' AND target_id IN (${WORK_ITEMS}))
        );
  `,
  wikiLinks: `
    SELECT COUNT(*)
    FROM wiki_page_links
    WHERE page_id NOT IN (${WIKI_PAGES})
        AND (
            (target_kind = 'page' AND target_id IN (${WIKI_PAGES}))
            OR (
                target_kind = 'ticket'
                AND target_id IN (
                    SELECT upper(key) FROM work_items WHERE project_id = $project_id
                )
            )
        );
  `,
};

/** A project as the deletion preview names it. */
export interface ProjectDeletionRecord {
  readonly name: string;
  readonly status: string;
  readonly isArchived: boolean;
}

/** Counts what a project deletion removes and clears, inside the caller's transaction. */
export class ProjectDeletionScopeRepository {
  private readonly database: DatabaseTransaction;

  /** Binds the counts to the transaction that will also delete. */
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Reads the identity of a project, whether it is active or archived. */
  public async findRecord(
    projectId: string,
  ): Promise<ProjectDeletionRecord | null> {
    const [row] = await this.database.query(
      `
        SELECT
            name,
            status,
            archived_at IS NOT NULL
        FROM projects
        WHERE id = $project_id;
      `,
      { project_id: projectId },
    );
    if (!row) return null;
    return {
      name: readTextColumn(row, 0, "name"),
      status: readTextColumn(row, 1, "status"),
      isArchived: readBooleanColumn(row, 2, "is_archived"),
    };
  }

  /** Lists the people assigned to the project, whose access disappears with it. */
  public async findMemberIds(projectId: string): Promise<string[]> {
    const rows = await this.database.query(
      `
        SELECT user_id
        FROM project_members
        WHERE project_id = $project_id
        ORDER BY user_id;
      `,
      { project_id: projectId },
    );
    return rows.map((row) => readTextColumn(row, 0, "user_id"));
  }

  /** Counts the data that belongs only to the project. */
  public async count(projectId: string): Promise<ProjectDeletionCounts> {
    const counts: Partial<Record<ProjectDeletionCountKey, number>> = {};
    for (const key of PROJECT_DELETION_COUNT_KEYS)
      counts[key] = await this.countOne(COUNT_STATEMENTS[key], projectId);
    if (!hasAllCounts(PROJECT_DELETION_COUNT_KEYS, counts))
      throw new Error("A count of the project deletion is missing.");
    return counts;
  }

  /** Counts the references of other objects that the deletion clears. */
  public async countDetachments(
    projectId: string,
  ): Promise<ProjectDeletionDetachments> {
    const boardPreferences = (
      await findReleasedBoardPreferences(this.database, projectId)
    ).length;
    // The keys are filled in their fixed order, so a stored result reads back unchanged.
    const counts: Partial<Record<ProjectDeletionDetachmentKey, number>> = {};
    for (const key of PROJECT_DELETION_DETACHMENT_KEYS)
      counts[key] =
        key === "boardPreferences"
          ? boardPreferences
          : await this.countOne(DETACHMENT_STATEMENTS[key], projectId);
    if (!hasAllCounts(PROJECT_DELETION_DETACHMENT_KEYS, counts))
      throw new Error("A count of the project deletion is missing.");
    return counts;
  }

  private async countOne(
    statement: string,
    projectId: string,
  ): Promise<number> {
    const [row] = await this.database.query(statement, {
      project_id: projectId,
    });
    return row ? readCountColumn(row, 0, "count") : 0;
  }
}
