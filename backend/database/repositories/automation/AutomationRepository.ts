import {
  readBooleanColumn,
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import {
  automationActionSchema,
  automationTriggerSchema,
} from "@/definition/AutomationSchema";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type {
  AutomationAction,
  AutomationAgentNotification,
  AutomationEventType,
  AutomationNotificationMode,
  AutomationSharing,
  AutomationTrigger,
} from "@/definition/Automation";

/** One automation as stored, with the full script content. */
export interface StoredAutomation {
  readonly id: string;
  readonly creatorId: string;
  readonly name: string;
  readonly trigger: AutomationTrigger;
  readonly action: AutomationAction;
  readonly sharing: AutomationSharing;
  readonly isActive: boolean;
  readonly deleteAfterSuccess: boolean;
  readonly agentNotification: AutomationAgentNotification;
  readonly nextRunAt: string | null;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Who reads a list, and how it is narrowed. */
export interface AutomationListQuery {
  readonly viewerId: string;
  /** Administrators see every automation. */
  readonly isAdministrator: boolean;
  readonly text?: string;
  readonly isActive?: boolean;
  /** Keyset of the last item of the previous page. */
  readonly after?: { readonly createdAt: string; readonly id: string };
  readonly limit: number;
}

type Executor = Pick<Database, "query" | "execute"> | DatabaseTransaction;

const COLUMNS = `
    automations.id,
    automations.creator_id,
    automations.name,
    automations.trigger_json,
    automations.action_json,
    automations.sharing_scope,
    automations.sharing_target_id,
    automations.is_active,
    automations.delete_after_success,
    automations.notification_mode,
    automations.notification_agent_id,
    automations.next_run_at,
    automations.revision,
    automations.created_at,
    automations.updated_at`;

/** The visibility of a list, as one condition: creator, administrator or a member of the share. */
const VISIBLE = `
    (
        $is_administrator
        OR automations.creator_id = $viewer_id
        OR (
            automations.sharing_scope = 'project'
            AND EXISTS (
                SELECT 1
                FROM project_members
                WHERE project_members.project_id = automations.sharing_target_id
                    AND project_members.user_id = $viewer_id
            )
        )
        OR (
            automations.sharing_scope = 'group'
            AND EXISTS (
                SELECT 1
                FROM user_group_members
                WHERE user_group_members.group_id = automations.sharing_target_id
                    AND user_group_members.user_id = $viewer_id
            )
        )
    )`;

function readSharing(row: readonly DatabaseValue[]): AutomationSharing {
  const scope = readTextColumn(row, 5, "sharing_scope");
  const target = readNullableTextColumn(row, 6, "sharing_target_id");
  if (scope === "project" && target)
    return { scope: "project", projectId: target };
  if (scope === "group" && target) return { scope: "group", groupId: target };
  return { scope: "private" };
}

function readMode(value: string): AutomationNotificationMode {
  return value === "error" || value === "always" ? value : "off";
}

function readAutomationRow(row: readonly DatabaseValue[]): StoredAutomation {
  const mode = readMode(readTextColumn(row, 9, "notification_mode"));
  const agentId = readNullableTextColumn(row, 10, "notification_agent_id");
  return {
    id: readTextColumn(row, 0, "id"),
    creatorId: readTextColumn(row, 1, "creator_id"),
    name: readTextColumn(row, 2, "name"),
    trigger: automationTriggerSchema.parse(
      JSON.parse(readTextColumn(row, 3, "trigger_json")),
    ),
    action: automationActionSchema.parse(
      JSON.parse(readTextColumn(row, 4, "action_json")),
    ),
    sharing: readSharing(row),
    isActive: readBooleanColumn(row, 7, "is_active"),
    deleteAfterSuccess: readBooleanColumn(row, 8, "delete_after_success"),
    agentNotification: mode === "off" ? { mode } : { mode, agentId },
    nextRunAt: readNullableTextColumn(row, 11, "next_run_at"),
    revision: readCountColumn(row, 12, "revision"),
    createdAt: readTextColumn(row, 13, "created_at"),
    updatedAt: readTextColumn(row, 14, "updated_at"),
  };
}

function sharingTarget(sharing: AutomationSharing): string | null {
  if (sharing.scope === "project") return sharing.projectId;
  if (sharing.scope === "group") return sharing.groupId;
  return null;
}

function eventTypeOf(trigger: AutomationTrigger): AutomationEventType | null {
  return trigger.type === "event" ? trigger.eventType : null;
}

function writeParameters(
  automation: StoredAutomation,
): Readonly<Record<string, string | number | boolean | null>> {
  return {
    id: automation.id,
    name: automation.name,
    trigger_type: automation.trigger.type,
    event_type: eventTypeOf(automation.trigger),
    trigger_json: JSON.stringify(automation.trigger),
    action_type: automation.action.type,
    action_json: JSON.stringify(automation.action),
    sharing_scope: automation.sharing.scope,
    sharing_target_id: sharingTarget(automation.sharing),
    is_active: automation.isActive,
    delete_after_success: automation.deleteAfterSuccess,
    notification_mode: automation.agentNotification.mode,
    notification_agent_id:
      automation.agentNotification.mode === "off"
        ? null
        : (automation.agentNotification.agentId ?? null),
    next_run_at: automation.nextRunAt,
    revision: automation.revision,
    updated_at: automation.updatedAt,
  };
}

/**
 * Stores automations (PAGE-297).
 *
 * @remarks
 * The definitions are stored as validated JSON; a read parses them again, so
 * a row that no longer fits the contract fails loudly instead of running.
 */
export class AutomationRepository {
  private readonly database: Executor;

  /**
   * Creates the repository.
   *
   * @param database - The database or an open transaction.
   */
  public constructor(database: Executor) {
    this.database = database;
  }

  /** Reads one automation; `null` when it does not exist. */
  public async find(id: string): Promise<StoredAutomation | null> {
    const [row] = await this.database.query(
      `SELECT ${COLUMNS} FROM automations WHERE automations.id = $id;`,
      { id },
    );
    return row ? readAutomationRow(row) : null;
  }

  /** Reads one automation and locks it until the transaction ends. */
  public async lock(id: string): Promise<StoredAutomation | null> {
    const [row] = await this.database.query(
      `SELECT ${COLUMNS} FROM automations WHERE automations.id = $id FOR UPDATE;`,
      { id },
    );
    return row ? readAutomationRow(row) : null;
  }

  /** Lists the automations a viewer may see, oldest first, one page at a time. */
  public async list(
    query: AutomationListQuery,
  ): Promise<readonly StoredAutomation[]> {
    const rows = await this.database.query(
      `
      SELECT ${COLUMNS}
      FROM automations
      WHERE ${VISIBLE}
          AND ($text = '' OR strpos(lower(automations.name), lower($text)) > 0)
          AND ($active_filter = '' OR automations.is_active = ($active_filter = 'true'))
          AND (
              $after_created_at = ''
              OR (automations.created_at, automations.id) > ($after_created_at, $after_id)
          )
      ORDER BY automations.created_at, automations.id
      LIMIT $limit;
    `,
      {
        viewer_id: query.viewerId,
        is_administrator: query.isAdministrator,
        text: query.text ?? "",
        active_filter:
          query.isActive === undefined ? "" : String(query.isActive),
        after_created_at: query.after?.createdAt ?? "",
        after_id: query.after?.id ?? "",
        limit: query.limit,
      },
    );
    return rows.map(readAutomationRow);
  }

  /** The active automations with a time trigger that is due. */
  public async due(
    now: string,
    limit: number,
  ): Promise<readonly StoredAutomation[]> {
    const rows = await this.database.query(
      `
      SELECT ${COLUMNS}
      FROM automations
      WHERE automations.is_active
          AND automations.next_run_at IS NOT NULL
          AND automations.next_run_at <= $now
      ORDER BY automations.next_run_at, automations.id
      LIMIT $limit;
    `,
      { now, limit },
    );
    return rows.map(readAutomationRow);
  }

  /** The active automations waiting for an event type. */
  public async waitingFor(
    eventType: AutomationEventType,
  ): Promise<readonly StoredAutomation[]> {
    const rows = await this.database.query(
      `
      SELECT ${COLUMNS}
      FROM automations
      WHERE automations.is_active
          AND automations.event_type = $event_type
      ORDER BY automations.created_at, automations.id;
    `,
      { event_type: eventType },
    );
    return rows.map(readAutomationRow);
  }

  /** Inserts a new automation. */
  public async insert(automation: StoredAutomation): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO automations (
          id,
          creator_id,
          name,
          trigger_type,
          event_type,
          trigger_json,
          action_type,
          action_json,
          sharing_scope,
          sharing_target_id,
          is_active,
          delete_after_success,
          notification_mode,
          notification_agent_id,
          next_run_at,
          revision,
          created_at,
          updated_at
      )
      VALUES (
          $id,
          $creator_id,
          $name,
          $trigger_type,
          $event_type,
          $trigger_json,
          $action_type,
          $action_json,
          $sharing_scope,
          $sharing_target_id,
          $is_active,
          $delete_after_success,
          $notification_mode,
          $notification_agent_id,
          $next_run_at,
          $revision,
          $created_at,
          $updated_at
      );
    `,
      {
        ...writeParameters(automation),
        creator_id: automation.creatorId,
        created_at: automation.createdAt,
      },
    );
  }

  /**
   * Replaces an automation whose stored revision is still the expected one.
   *
   * @returns Whether the row was written.
   */
  public async replace(
    automation: StoredAutomation,
    expectedRevision: number,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
      UPDATE automations
      SET
          name = $name,
          trigger_type = $trigger_type,
          event_type = $event_type,
          trigger_json = $trigger_json,
          action_type = $action_type,
          action_json = $action_json,
          sharing_scope = $sharing_scope,
          sharing_target_id = $sharing_target_id,
          is_active = $is_active,
          delete_after_success = $delete_after_success,
          notification_mode = $notification_mode,
          notification_agent_id = $notification_agent_id,
          next_run_at = $next_run_at,
          revision = $revision,
          updated_at = $updated_at
      WHERE id = $id
          AND revision = $expected_revision
      RETURNING id;
    `,
      { ...writeParameters(automation), expected_revision: expectedRevision },
    );
    return rows.length > 0;
  }

  /** Moves the next due time without changing the revision. */
  public async schedule(id: string, nextRunAt: string | null): Promise<void> {
    await this.database.execute(
      "UPDATE automations SET next_run_at = $next_run_at WHERE id = $id;",
      { id, next_run_at: nextRunAt },
    );
  }

  /** Removes an automation with its runs. */
  public async delete(id: string): Promise<void> {
    await this.database.execute("DELETE FROM automations WHERE id = $id;", {
      id,
    });
  }
}
