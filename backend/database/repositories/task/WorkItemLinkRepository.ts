import { readBooleanColumn, readTextColumn } from "@/backend/database/RowValue";
import { isWorkItemLinkType } from "@/definition/Task";

import { createWorkItemVisibility } from "./WorkItemVisibility";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  WorkItemLink,
  WorkItemLinkType,
  WorkItemVisibility,
} from "@/definition/Task";

/** A stored link between two work items, without the data of the linked item. */
export interface StoredWorkItemLink {
  readonly id: string;
  readonly workItemId: string;
  readonly linkedWorkItemId: string;
  readonly linkType: WorkItemLinkType;
}

/** Values required to persist a new link between two work items. */
export interface NewWorkItemLink {
  readonly id: string;
  readonly workItemId: string;
  readonly linkedWorkItemId: string;
  readonly linkType: WorkItemLinkType;
}

function readWorkItemLinkType(
  row: readonly DatabaseValue[],
  index: number,
): WorkItemLinkType {
  const linkType = readTextColumn(row, index, "link_type");

  if (!isWorkItemLinkType(linkType)) {
    throw new Error(
      `Database returned an unsupported link type "${linkType}".`,
    );
  }

  return linkType;
}

function readWorkItemLinkDirection(
  row: readonly DatabaseValue[],
): WorkItemLink["direction"] {
  const direction = readTextColumn(row, 2, "direction");

  if (direction !== "outgoing" && direction !== "incoming") {
    throw new Error(
      `Database returned an unsupported link direction "${direction}".`,
    );
  }

  return direction;
}

function toWorkItemLink(row: readonly DatabaseValue[]): WorkItemLink {
  const linkType = readWorkItemLinkType(row, 1);
  const direction = readWorkItemLinkDirection(row);

  return {
    createdAt: readTextColumn(row, 8, "created_at"),
    direction,
    id: readTextColumn(row, 0, "id"),
    linkType,
    linkedWorkItemId: readTextColumn(row, 3, "linked_work_item_id"),
    linkedWorkItemIsDone: readBooleanColumn(row, 7, "linked_work_item_is_done"),
    linkedWorkItemKey: readTextColumn(row, 4, "linked_work_item_key"),
    linkedWorkItemStatusKey: readTextColumn(
      row,
      6,
      "linked_work_item_status_key",
    ),
    linkedWorkItemTitle: readTextColumn(row, 5, "linked_work_item_title"),
  };
}

function toStoredWorkItemLink(
  row: readonly DatabaseValue[],
): StoredWorkItemLink {
  return {
    id: readTextColumn(row, 0, "id"),
    linkType: readWorkItemLinkType(row, 3),
    linkedWorkItemId: readTextColumn(row, 2, "linked_work_item_id"),
    workItemId: readTextColumn(row, 1, "work_item_id"),
  };
}

/** Owns persistence operations for links between work items. */
export class WorkItemLinkRepository {
  private readonly database: Database;

  /**
   * Creates a work item link repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /**
   * Returns every link involving a work item, from that item's own point
   * of view (outgoing rows stored on it, plus incoming rows stored on the
   * other side of the relation).
   */
  public async findByWorkItemId(
    workItemId: string,
    visibility?: WorkItemVisibility,
  ): Promise<WorkItemLink[]> {
    const scope = createWorkItemVisibility(visibility);
    const rows = await this.database.query(
      `
        SELECT
            work_item_links.id,
            work_item_links.link_type,
            'outgoing' AS direction,
            work_items.id AS linked_work_item_id,
            work_items.key AS linked_work_item_key,
            work_items.title AS linked_work_item_title,
            workflow_statuses.key AS linked_work_item_status_key,
            workflow_statuses.is_done AS linked_work_item_is_done,
            work_item_links.created_at AS created_at
        FROM work_item_links
        INNER JOIN work_items
            ON work_items.id = work_item_links.linked_work_item_id
        INNER JOIN workflow_statuses
            ON workflow_statuses.id = work_items.status_id
        WHERE work_item_links.work_item_id = $work_item_id
            AND ${scope.condition}

        UNION ALL

        SELECT
            work_item_links.id,
            work_item_links.link_type,
            'incoming' AS direction,
            work_items.id AS linked_work_item_id,
            work_items.key AS linked_work_item_key,
            work_items.title AS linked_work_item_title,
            workflow_statuses.key AS linked_work_item_status_key,
            workflow_statuses.is_done AS linked_work_item_is_done,
            work_item_links.created_at AS created_at
        FROM work_item_links
        INNER JOIN work_items
            ON work_items.id = work_item_links.work_item_id
        INNER JOIN workflow_statuses
            ON workflow_statuses.id = work_items.status_id
        WHERE work_item_links.linked_work_item_id = $work_item_id
            AND ${scope.condition};
      `,
      { work_item_id: workItemId, ...scope.parameters },
    );

    return rows.map(toWorkItemLink);
  }

  /** Returns a single link by its identifier. */
  public async findById(id: string): Promise<StoredWorkItemLink | null> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            work_item_id,
            linked_work_item_id,
            link_type
        FROM work_item_links
        WHERE id = $id;
      `,
      { id },
    );
    const row = rows[0];

    return row ? toStoredWorkItemLink(row) : null;
  }

  /** Persists a new link between two work items. */
  public async insert(link: NewWorkItemLink): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO work_item_links (
            id,
            work_item_id,
            linked_work_item_id,
            link_type,
            created_at
        )
        VALUES (
            $id,
            $work_item_id,
            $linked_work_item_id,
            $link_type,
            utc_now()
        )
        ON CONFLICT (work_item_id, linked_work_item_id, link_type) DO NOTHING;
      `,
      {
        id: link.id,
        link_type: link.linkType,
        linked_work_item_id: link.linkedWorkItemId,
        work_item_id: link.workItemId,
      },
    );
  }

  /** Deletes a link by its identifier. */
  public async delete(id: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM work_item_links
        WHERE id = $id;
      `,
      { id },
    );
  }
}
