import { readBooleanColumn, readTextColumn } from "@/backend/database/RowValue";
import { DISCORD_EVENT_TYPES } from "@/definition/Discord";

import type { DatabaseValue } from "@/backend/database/Database";
import type { DiscordDatabase } from "@/backend/database/repositories/discord/DiscordDatabase";
import type {
  DiscordEventSelection,
  DiscordEventType,
} from "@/definition/Discord";

/** The stored Discord connection of a project, including server-only fields. */
export interface StoredDiscordConnection {
  readonly projectId: string;
  readonly guildId: string;
  readonly guildName: string;
  readonly channelId: string;
  readonly channelName: string;
  /** Public address of this Pages instance, used for the links in messages. */
  readonly baseUrl: string;
  readonly events: DiscordEventSelection;
  readonly connectedBy: string;
  readonly connectedAt: string;
  readonly updatedAt: string;
}

/** What a confirmed connection writes; the event selection is kept or defaulted by the caller. */
export interface NewDiscordConnection {
  readonly projectId: string;
  readonly guildId: string;
  readonly guildName: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly baseUrl: string;
  readonly events: DiscordEventSelection;
  readonly connectedBy: string;
  readonly now: string;
}

/** The persistence the Discord services use for the connection of a project. */
export interface DiscordConnectionStore {
  findConnection(projectId: string): Promise<StoredDiscordConnection | null>;
  saveConnection(connection: NewDiscordConnection): Promise<void>;
  updateChannel(
    projectId: string,
    channel: { readonly id: string; readonly name: string },
    now: string,
  ): Promise<void>;
  updateEvents(
    projectId: string,
    events: DiscordEventSelection,
    now: string,
  ): Promise<void>;
  /** Removes the connection and every stored message of the project; returns whether a connection existed. */
  deleteConnection(projectId: string): Promise<boolean>;
}

const EVENT_COLUMNS: Readonly<Record<DiscordEventType, string>> = {
  "milestone.created": "notify_milestone_created",
  "milestone.updated": "notify_milestone_updated",
  "ticket.created": "notify_ticket_created",
  "ticket.updated": "notify_ticket_updated",
};

const CONNECTION_COLUMNS = `
            project_id,
            guild_id,
            guild_name,
            channel_id,
            channel_name,
            base_url,
            notify_ticket_created,
            notify_ticket_updated,
            notify_milestone_created,
            notify_milestone_updated,
            connected_by,
            connected_at,
            updated_at`;

function toFlag(isOn: boolean): number {
  return isOn ? 1 : 0;
}

function toEventParameters(
  events: DiscordEventSelection,
): Record<string, number> {
  const parameters: Record<string, number> = {};

  for (const type of DISCORD_EVENT_TYPES) {
    parameters[EVENT_COLUMNS[type]] = toFlag(events[type]);
  }

  return parameters;
}

function toConnection(row: readonly DatabaseValue[]): StoredDiscordConnection {
  return {
    baseUrl: readTextColumn(row, 5, "base_url"),
    channelId: readTextColumn(row, 3, "channel_id"),
    channelName: readTextColumn(row, 4, "channel_name"),
    connectedAt: readTextColumn(row, 11, "connected_at"),
    connectedBy: readTextColumn(row, 10, "connected_by"),
    events: {
      "milestone.created": readBooleanColumn(
        row,
        8,
        "notify_milestone_created",
      ),
      "milestone.updated": readBooleanColumn(
        row,
        9,
        "notify_milestone_updated",
      ),
      "ticket.created": readBooleanColumn(row, 6, "notify_ticket_created"),
      "ticket.updated": readBooleanColumn(row, 7, "notify_ticket_updated"),
    },
    guildId: readTextColumn(row, 1, "guild_id"),
    guildName: readTextColumn(row, 2, "guild_name"),
    projectId: readTextColumn(row, 0, "project_id"),
    updatedAt: readTextColumn(row, 12, "updated_at"),
  };
}

const INSERT_CONNECTION = `
  INSERT INTO project_discord_connections (
      project_id,
      guild_id,
      guild_name,
      channel_id,
      channel_name,
      base_url,
      notify_ticket_created,
      notify_ticket_updated,
      notify_milestone_created,
      notify_milestone_updated,
      connected_by,
      connected_at,
      updated_at
  )
  VALUES (
      $project_id,
      $guild_id,
      $guild_name,
      $channel_id,
      $channel_name,
      $base_url,
      $notify_ticket_created,
      $notify_ticket_updated,
      $notify_milestone_created,
      $notify_milestone_updated,
      $connected_by,
      $now,
      $now
  );
`;

const UPDATE_CONNECTION = `
  UPDATE project_discord_connections
  SET
      guild_id = $guild_id,
      guild_name = $guild_name,
      channel_id = $channel_id,
      channel_name = $channel_name,
      base_url = $base_url,
      notify_ticket_created = $notify_ticket_created,
      notify_ticket_updated = $notify_ticket_updated,
      notify_milestone_created = $notify_milestone_created,
      notify_milestone_updated = $notify_milestone_updated,
      connected_by = $connected_by,
      updated_at = $now
  WHERE project_id = $project_id;
`;

/** Establishes the persistence boundary for the Discord connection of a project. */
export class DiscordConnectionRepository implements DiscordConnectionStore {
  private readonly database: DiscordDatabase;

  /**
   * Creates a Discord connection repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: DiscordDatabase) {
    this.database = database;
  }

  /** Returns the connection of a project, or `null` without one. */
  public async findConnection(
    projectId: string,
  ): Promise<StoredDiscordConnection | null> {
    const rows = await this.database.query(
      `
        SELECT${CONNECTION_COLUMNS}
        FROM project_discord_connections
        WHERE project_id = $project_id;
      `,
      { project_id: projectId },
    );
    const row = rows[0];

    return row ? toConnection(row) : null;
  }

  /** Inserts the connection of a project or replaces the one it has. */
  public async saveConnection(connection: NewDiscordConnection): Promise<void> {
    const parameters = {
      base_url: connection.baseUrl,
      channel_id: connection.channelId,
      channel_name: connection.channelName,
      connected_by: connection.connectedBy,
      guild_id: connection.guildId,
      guild_name: connection.guildName,
      now: connection.now,
      project_id: connection.projectId,
      ...toEventParameters(connection.events),
    };

    await this.database.transaction(async (transaction) => {
      const existing = await transaction.query(
        "SELECT project_id FROM project_discord_connections WHERE project_id = $project_id;",
        { project_id: connection.projectId },
      );

      if (existing.length > 0) {
        await transaction.execute(UPDATE_CONNECTION, parameters);
        return;
      }

      await transaction.execute(INSERT_CONNECTION, parameters);
    });
  }

  /** Points the project at another channel of the same server. */
  public async updateChannel(
    projectId: string,
    channel: { readonly id: string; readonly name: string },
    now: string,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE project_discord_connections
        SET
            channel_id = $channel_id,
            channel_name = $channel_name,
            updated_at = $now
        WHERE project_id = $project_id;
      `,
      {
        channel_id: channel.id,
        channel_name: channel.name,
        now,
        project_id: projectId,
      },
    );
  }

  /** Stores the independent switches of the four events. */
  public async updateEvents(
    projectId: string,
    events: DiscordEventSelection,
    now: string,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE project_discord_connections
        SET
            notify_ticket_created = $notify_ticket_created,
            notify_ticket_updated = $notify_ticket_updated,
            notify_milestone_created = $notify_milestone_created,
            notify_milestone_updated = $notify_milestone_updated,
            updated_at = $now
        WHERE project_id = $project_id;
      `,
      { now, project_id: projectId, ...toEventParameters(events) },
    );
  }

  /** Removes the connection and every stored message of the project. */
  public async deleteConnection(projectId: string): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const existing = await transaction.query(
        "SELECT project_id FROM project_discord_connections WHERE project_id = $project_id;",
        { project_id: projectId },
      );

      await transaction.execute(
        "DELETE FROM project_discord_connections WHERE project_id = $project_id;",
        { project_id: projectId },
      );
      await transaction.execute(
        "DELETE FROM discord_deliveries WHERE project_id = $project_id;",
        { project_id: projectId },
      );

      return existing.length > 0;
    });
  }
}
