import { readTextColumn } from "@/backend/database/RowValue";
import { CALENDAR_INVITEE_KINDS } from "@/definition/Calendar";

import { calendarInList } from "./CalendarSql";

import type { CalendarDatabase } from "./CalendarEventRepository";
import type {
  CalendarAnswer,
  CalendarInviteeKind,
  CalendarInviteeReference,
} from "@/definition/Calendar";

/** One stored invitation of an event. */
export interface CalendarInvitationRecord {
  readonly eventId: string;
  readonly kind: CalendarInviteeKind;
  readonly inviteeId: string;
}

/** One stored answer of a person. */
export interface CalendarResponseRecord {
  readonly eventId: string;
  readonly userId: string;
  readonly response: CalendarAnswer;
}

/** A stored answer of a change, for a repeated call with the same operation ID. */
export interface CalendarOperationRecord {
  readonly requestDigest: string;
  readonly response: string;
}

function isInviteeKind(value: string): value is CalendarInviteeKind {
  return (CALENDAR_INVITEE_KINDS as readonly string[]).includes(value);
}

function readAnswer(value: string): CalendarAnswer {
  if (value === "accepted" || value === "declined") return value;
  throw new Error('Database returned an invalid value for "response".');
}

/** Owns invitations, answers and stored operations of the calendar (PAGE-301). */
export class CalendarParticipationRepository {
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
   * Returns the invitations of events in their stored order.
   *
   * @param eventIds - Event identifiers.
   */
  public async findInvitations(
    eventIds: readonly string[],
  ): Promise<CalendarInvitationRecord[]> {
    const events = calendarInList("event_id", eventIds);
    const rows = await this.database.query(
      `
        SELECT
            event_id,
            invitee_kind,
            invitee_id
        FROM calendar_event_invitations
        WHERE event_id IN (${events.placeholders})
        ORDER BY event_id, position, invitee_id;
      `,
      events.parameters,
    );
    return rows.flatMap((row) => {
      const kind = readTextColumn(row, 1, "invitee_kind");
      if (!isInviteeKind(kind)) return [];
      return [
        {
          eventId: readTextColumn(row, 0, "event_id"),
          kind,
          inviteeId: readTextColumn(row, 2, "invitee_id"),
        },
      ];
    });
  }

  /**
   * Replaces the invitations of an event.
   *
   * @param eventId - Event identifier.
   * @param invitees - The new list in its order.
   */
  public async replaceInvitations(
    eventId: string,
    invitees: readonly CalendarInviteeReference[],
  ): Promise<void> {
    await this.database.execute(
      "DELETE FROM calendar_event_invitations WHERE event_id = $event_id;",
      { event_id: eventId },
    );
    for (const [position, invitee] of invitees.entries()) {
      await this.database.execute(
        `
          INSERT INTO calendar_event_invitations (
              event_id,
              invitee_kind,
              invitee_id,
              position
          )
          VALUES (
              $event_id,
              $invitee_kind,
              $invitee_id,
              $position
          )
          ON CONFLICT (event_id, invitee_kind, invitee_id) DO NOTHING;
        `,
        {
          event_id: eventId,
          invitee_kind: invitee.kind,
          invitee_id: invitee.id,
          position,
        },
      );
    }
  }

  /**
   * Returns the answers given to events.
   *
   * @param eventIds - Event identifiers.
   */
  public async findResponses(
    eventIds: readonly string[],
  ): Promise<CalendarResponseRecord[]> {
    const events = calendarInList("event_id", eventIds);
    const rows = await this.database.query(
      `
        SELECT
            event_id,
            user_id,
            response
        FROM calendar_event_responses
        WHERE event_id IN (${events.placeholders})
        ORDER BY event_id, user_id;
      `,
      events.parameters,
    );
    return rows.map((row) => ({
      eventId: readTextColumn(row, 0, "event_id"),
      userId: readTextColumn(row, 1, "user_id"),
      response: readAnswer(readTextColumn(row, 2, "response")),
    }));
  }

  /**
   * Stores or replaces the answer of a person.
   *
   * @param record - Event, person and answer.
   */
  public async saveResponse(record: CalendarResponseRecord): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO calendar_event_responses (
            event_id,
            user_id,
            response
        )
        VALUES (
            $event_id,
            $user_id,
            $response
        )
        ON CONFLICT (event_id, user_id) DO UPDATE SET
            response = excluded.response,
            updated_at = utc_now();
      `,
      {
        event_id: record.eventId,
        user_id: record.userId,
        response: record.response,
      },
    );
  }

  /**
   * Copies the answers of one event to another, for a split series.
   *
   * @param fromEventId - The old series.
   * @param toEventId - The new series.
   */
  public async copyResponses(
    fromEventId: string,
    toEventId: string,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO calendar_event_responses (
            event_id,
            user_id,
            response
        )
        SELECT
            $to_event_id,
            user_id,
            response
        FROM calendar_event_responses
        WHERE event_id = $from_event_id
        ON CONFLICT (event_id, user_id) DO NOTHING;
      `,
      { from_event_id: fromEventId, to_event_id: toEventId },
    );
  }

  /**
   * Sets every acceptance of an event back to open; declines stay.
   *
   * @param eventId - Event identifier.
   */
  public async reopenAcceptances(eventId: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM calendar_event_responses
        WHERE event_id = $event_id
            AND response = 'accepted';
      `,
      { event_id: eventId },
    );
  }

  /**
   * Tells whether an account is affected by an event or a project calendar,
   * deleted events included, so a live notice reaches who saw it.
   *
   * @param userId - The account.
   * @param objectId - An event ID, or `project:<projectId>` for the project
   * dates of a project.
   */
  public async isAffected(userId: string, objectId: string): Promise<boolean> {
    if (objectId.startsWith("project:")) {
      const rows = await this.database.query(
        `
          SELECT 1
          FROM project_members
          WHERE project_id = $project_id
              AND user_id = $user_id;
        `,
        { project_id: objectId.slice("project:".length), user_id: userId },
      );
      return rows.length > 0;
    }
    const rows = await this.database.query(
      `
        SELECT 1
        FROM calendar_events
        WHERE calendar_events.id = $event_id
            AND (
                calendar_events.created_by = $user_id
                OR EXISTS (
                    SELECT 1
                    FROM project_members
                    WHERE project_members.project_id = calendar_events.project_id
                        AND project_members.user_id = $user_id
                )
                OR EXISTS (
                    SELECT 1
                    FROM calendar_event_invitations AS invitation
                    WHERE invitation.event_id = calendar_events.id
                        AND (
                            (invitation.invitee_kind IN ('person', 'agent') AND invitation.invitee_id = $user_id)
                            OR (invitation.invitee_kind = 'group' AND invitation.invitee_id IN (
                                SELECT group_id FROM user_group_members WHERE user_id = $user_id
                            ))
                            OR (invitation.invitee_kind = 'department' AND invitation.invitee_id IN (
                                SELECT department_id FROM department_members WHERE user_id = $user_id
                            ))
                        )
                )
            );
      `,
      { event_id: objectId, user_id: userId },
    );
    return rows.length > 0;
  }

  /**
   * Returns the stored answer of an operation.
   *
   * @param accountId - The acting account.
   * @param operationId - The operation ID of the client.
   */
  public async findOperation(
    accountId: string,
    operationId: string,
  ): Promise<CalendarOperationRecord | null> {
    const rows = await this.database.query(
      `
        SELECT
            request_digest,
            response
        FROM calendar_operations
        WHERE account_id = $account_id
            AND operation_id = $operation_id;
      `,
      { account_id: accountId, operation_id: operationId },
    );
    const row = rows[0];
    return row
      ? {
          requestDigest: readTextColumn(row, 0, "request_digest"),
          response: readTextColumn(row, 1, "response"),
        }
      : null;
  }

  /**
   * Stores the answer of an operation once.
   *
   * @param accountId - The acting account.
   * @param operationId - The operation ID of the client.
   * @param record - Digest of the request and the answer as JSON.
   */
  public async saveOperation(
    accountId: string,
    operationId: string,
    record: CalendarOperationRecord,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO calendar_operations (
            account_id,
            operation_id,
            request_digest,
            response
        )
        VALUES (
            $account_id,
            $operation_id,
            $request_digest,
            $response
        )
        ON CONFLICT (account_id, operation_id) DO NOTHING;
      `,
      {
        account_id: accountId,
        operation_id: operationId,
        request_digest: record.requestDigest,
        response: record.response,
      },
    );
  }
}
