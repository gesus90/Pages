import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { createWorkItemVisibility } from "@/backend/database/repositories/task/WorkItemVisibility";

import { calendarInList } from "./CalendarSql";

import type { CalendarDatabase } from "./CalendarEventRepository";
import type { WorkItemVisibility } from "@/definition/Task";

/** A date of the planning of a project (Projekt → Termine). */
export interface CalendarProjectDateRecord {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly title: string;
  readonly description: string;
  readonly date: string;
  /** `HH:mm`, or `null` for a date without time. */
  readonly time: string | null;
}

/** A ticket due on a date. */
export interface CalendarDueTicketRecord {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly date: string;
}

/** A milestone with a due date. */
export interface CalendarMilestoneRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly date: string;
}

/** A range of dates, both inclusive. */
export interface CalendarDateRange {
  readonly fromDate: string;
  readonly toDate: string;
}

/**
 * Reads what appears in the calendar without being an event of it: project
 * dates, due tickets and milestones (PAGE-301). Archived tickets, projects,
 * milestones and project dates never appear.
 */
export class CalendarSourceRepository {
  private readonly database: CalendarDatabase;

  /**
   * Creates the repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: CalendarDatabase) {
    this.database = database;
  }

  /**
   * Returns the project dates of projects in a range.
   *
   * @param projectIds - The member projects of the viewer.
   * @param range - The dates.
   */
  public async findProjectDates(
    projectIds: readonly string[],
    range: CalendarDateRange,
  ): Promise<CalendarProjectDateRecord[]> {
    const projects = calendarInList("project_id", projectIds);
    const rows = await this.database.query(
      `
        SELECT
            project_events.id,
            project_events.project_id,
            projects.name,
            project_events.title,
            COALESCE(project_events.description, ''),
            project_events.event_date,
            project_events.event_time
        FROM project_events
        INNER JOIN projects
            ON projects.id = project_events.project_id
        WHERE project_events.project_id IN (${projects.placeholders})
            AND project_events.archived_at IS NULL
            AND projects.archived_at IS NULL
            AND project_events.event_date BETWEEN $from_date AND $to_date
        ORDER BY project_events.event_date, project_events.event_time NULLS FIRST, project_events.id;
      `,
      {
        ...projects.parameters,
        from_date: range.fromDate,
        to_date: range.toDate,
      },
    );
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      projectId: readTextColumn(row, 1, "project_id"),
      projectName: readTextColumn(row, 2, "name"),
      title: readTextColumn(row, 3, "title"),
      description: readTextColumn(row, 4, "description"),
      date: readTextColumn(row, 5, "event_date"),
      time: readNullableTextColumn(row, 6, "event_time")?.slice(0, 5) ?? null,
    }));
  }

  /**
   * Returns the visible active tickets due in a range that are assigned to an
   * account or to one of its groups.
   *
   * @param assignee - The account and its groups.
   * @param visibility - The ticket visibility of the account.
   * @param range - The dates.
   */
  public async findDueTickets(
    assignee: { readonly userId: string; readonly groupIds: readonly string[] },
    visibility: WorkItemVisibility,
    range: CalendarDateRange,
  ): Promise<CalendarDueTicketRecord[]> {
    const groups = calendarInList("assignee_group_id", assignee.groupIds);
    const visible = createWorkItemVisibility(visibility);
    const rows = await this.database.query(
      `
        SELECT
            work_items.id,
            work_items."key",
            work_items.title,
            work_items.project_id,
            projects.name,
            substring(work_items.due_at from 1 for 10) AS due_date
        FROM work_items
        INNER JOIN projects
            ON projects.id = work_items.project_id
        WHERE work_items.due_at IS NOT NULL
            AND work_items.archived_at IS NULL
            AND projects.archived_at IS NULL
            AND substring(work_items.due_at from 1 for 10) BETWEEN $from_date AND $to_date
            AND (
                work_items.assignee_id = $user_id
                OR work_items.assignee_group_id IN (${groups.placeholders})
            )
            AND ${visible.condition}
        ORDER BY due_date, work_items."key";
      `,
      {
        ...groups.parameters,
        ...visible.parameters,
        user_id: assignee.userId,
        from_date: range.fromDate,
        to_date: range.toDate,
      },
    );
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      key: readTextColumn(row, 1, "key"),
      title: readTextColumn(row, 2, "title"),
      projectId: readTextColumn(row, 3, "project_id"),
      projectName: readTextColumn(row, 4, "name"),
      date: readTextColumn(row, 5, "due_date"),
    }));
  }

  /**
   * Returns the active milestones of projects due in a range.
   *
   * @param projectIds - The member projects of the viewer.
   * @param range - The dates.
   */
  public async findMilestones(
    projectIds: readonly string[],
    range: CalendarDateRange,
  ): Promise<CalendarMilestoneRecord[]> {
    const projects = calendarInList("project_id", projectIds);
    const rows = await this.database.query(
      `
        SELECT
            milestones.id,
            milestones.name,
            COALESCE(milestones.description, ''),
            milestones.project_id,
            projects.name,
            substring(milestones.due_at from 1 for 10) AS due_date
        FROM milestones
        INNER JOIN projects
            ON projects.id = milestones.project_id
        WHERE milestones.project_id IN (${projects.placeholders})
            AND milestones.due_at IS NOT NULL
            AND milestones.archived_at IS NULL
            AND milestones.status <> 'archived'
            AND projects.archived_at IS NULL
            AND substring(milestones.due_at from 1 for 10) BETWEEN $from_date AND $to_date
        ORDER BY due_date, milestones.name;
      `,
      {
        ...projects.parameters,
        from_date: range.fromDate,
        to_date: range.toDate,
      },
    );
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      name: readTextColumn(row, 1, "name"),
      description: readTextColumn(row, 2, "description"),
      projectId: readTextColumn(row, 3, "project_id"),
      projectName: readTextColumn(row, 4, "project_name"),
      date: readTextColumn(row, 5, "due_date"),
    }));
  }

  /**
   * Returns the names of projects, archived ones left out.
   *
   * @param projectIds - Project identifiers.
   */
  public async findProjectNames(
    projectIds: readonly string[],
  ): Promise<{ readonly id: string; readonly name: string }[]> {
    const projects = calendarInList("project_id", projectIds);
    const rows = await this.database.query(
      `
        SELECT
            id,
            name
        FROM projects
        WHERE id IN (${projects.placeholders})
            AND archived_at IS NULL;
      `,
      projects.parameters,
    );
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      name: readTextColumn(row, 1, "name"),
    }));
  }
}
