import {
  readBooleanColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";

/** The notification choices of one account. */
export interface NotificationPreferenceRecord {
  readonly accountId: string;
  /** Whether runs other people start in plans of the account's teams are announced. */
  readonly teamRuns: boolean;
  /** The moment `teamRuns` was last switched on; `null` while it is off. */
  readonly teamRunsSince: string | null;
}

const PREFERENCE_COLUMNS = `
    account_id,
    team_runs,
    team_runs_since`;

function toPreference(
  row: readonly DatabaseValue[],
): NotificationPreferenceRecord {
  const teamRuns = readBooleanColumn(row, 1, "team_runs");

  return {
    accountId: readTextColumn(row, 0, "account_id"),
    teamRuns,
    teamRunsSince: teamRuns
      ? readNullableTextColumn(row, 2, "team_runs_since")
      : null,
  };
}

/**
 * Persistence of the notification choices an account makes in Pica Mobile.
 *
 * @remarks
 * A choice belongs to the account on this Pages instance, never to a device or
 * a session, so it survives a new registration and a restart. An account
 * without a stored choice has every choice off.
 */
export class PicaMobileNotificationPreferenceRepository {
  private readonly database: Pick<Database, "execute" | "query">;

  /**
   * Creates the repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Pick<Database, "execute" | "query">) {
    this.database = database;
  }

  /**
   * Reads the choices of an account.
   *
   * @param accountId - The account.
   * @returns The stored choices, or every choice off when none is stored.
   */
  public async find(accountId: string): Promise<NotificationPreferenceRecord> {
    const [row] = await this.database.query(
      `
        SELECT${PREFERENCE_COLUMNS}
        FROM pica_mobile_notification_preferences
        WHERE account_id = $account_id;
      `,
      { account_id: accountId },
    );

    return row === undefined
      ? { accountId, teamRuns: false, teamRunsSince: null }
      : toPreference(row);
  }

  /**
   * Switches the announcement of team runs for an account.
   *
   * @param accountId - The account; only ever the authenticated one.
   * @param isEnabled - The new choice.
   * @param now - The moment of the change as ISO-8601 text.
   * @returns The choices as stored now.
   *
   * @remarks
   * Switching it on again keeps the earlier moment, so a repeated request
   * changes nothing; switching it off forgets the moment, so switching it on
   * later never reaches back.
   */
  public async setTeamRuns(
    accountId: string,
    isEnabled: boolean,
    now: string,
  ): Promise<NotificationPreferenceRecord> {
    await this.database.execute(
      `
        INSERT INTO pica_mobile_notification_preferences (
            account_id,
            team_runs,
            team_runs_since,
            updated_at
        ) VALUES (
            $account_id,
            $team_runs,
            CASE WHEN $team_runs THEN $now ELSE NULL END,
            $now
        )
        ON CONFLICT (account_id) DO UPDATE SET
            team_runs = excluded.team_runs,
            team_runs_since = CASE
                WHEN NOT excluded.team_runs THEN NULL
                WHEN pica_mobile_notification_preferences.team_runs
                    THEN pica_mobile_notification_preferences.team_runs_since
                ELSE excluded.team_runs_since
            END,
            updated_at = excluded.updated_at;
      `,
      { account_id: accountId, team_runs: isEnabled, now },
    );

    return this.find(accountId);
  }

  /**
   * Lists the accounts that want team runs and have an active device.
   *
   * @returns The choices of those accounts, oldest choice first.
   *
   * @remarks
   * This only narrows who is asked; whether an account belongs to the team of
   * a plan and may read a run is decided for every run again.
   */
  public async listTeamRecipients(): Promise<
    readonly NotificationPreferenceRecord[]
  > {
    const rows = await this.database.query(
      `
        SELECT${PREFERENCE_COLUMNS}
        FROM pica_mobile_notification_preferences
        WHERE team_runs
            AND EXISTS (
                SELECT 1
                FROM pica_mobile_push_registrations AS registrations
                WHERE registrations.account_id = pica_mobile_notification_preferences.account_id
                    AND registrations.activated_at IS NOT NULL
            )
        ORDER BY team_runs_since ASC, account_id ASC;
      `,
    );

    return rows.map((row) => toPreference(row));
  }
}
