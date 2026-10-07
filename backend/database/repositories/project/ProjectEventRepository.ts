import { readTextColumn } from "@/backend/database/RowValue";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { ProjectEvent } from "@/definition/Project";

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

function toProjectEvent(row: readonly DatabaseValue[]): ProjectEvent {
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

/** Owns persistence operations for project planning dates. */
export class ProjectEventRepository {
  private readonly database: DatabaseTransaction;

  /**
   * Creates a project event repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Returns the non-archived planning dates of a project. */
  public async findByProjectId(projectId: string): Promise<ProjectEvent[]> {
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

    return rows.map(toProjectEvent);
  }

  /** Inserts a planning date for the project. */
  public async insert(event: NewProjectEvent): Promise<void> {
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
            utc_now()
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
  public async update(id: string, event: ProjectEventUpdate): Promise<void> {
    await this.database.execute(
      `
        UPDATE project_events
        SET
            title = $title,
            description = $description,
            event_date = $event_date,
            event_time = $event_time,
            type = $type,
            updated_at = utc_now()
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
  public async archive(id: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE project_events
        SET
            archived_at = utc_now(),
            updated_at = utc_now()
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      { id },
    );
  }
}
