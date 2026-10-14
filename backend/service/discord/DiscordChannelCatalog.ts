import {
  computeChannelPermissions,
  findMissingPermissions,
} from "@/backend/discord/DiscordPermissions";

import type {
  DiscordApiClient,
  DiscordCallResult,
  DiscordChannel,
  DiscordGuild,
} from "@/backend/discord/DiscordApiClient";
import type { DiscordChannelChoice } from "@/definition/Discord";

/** The part of the Discord client the channel list needs. */
export type DiscordCatalogClient = Pick<
  DiscordApiClient,
  "getGuild" | "getChannels" | "getBotRoleIds"
>;

function toChoice(
  channel: DiscordChannel,
  guild: DiscordGuild,
  botUserId: string,
  botRoleIds: readonly string[],
): DiscordChannelChoice {
  const missing = findMissingPermissions(
    computeChannelPermissions({
      botRoleIds,
      botUserId,
      guildId: guild.id,
      overwrites: channel.overwrites,
      ownerId: guild.ownerId,
      roles: guild.roles,
    }),
  );

  return {
    id: channel.id,
    isSelectable: missing.length === 0,
    kind: channel.kind,
    missing,
    name: channel.name,
  };
}

/**
 * Lists the channels of a server together with what the bot may do in each.
 *
 * @remarks
 * Only text and announcement channels exist in the list. A channel is
 * selectable when the bot can see it and send in it; every other channel stays
 * in the list with the permissions it lacks, so the interface can explain why
 * it cannot be chosen.
 */
export class DiscordChannelCatalog {
  private readonly client: DiscordCatalogClient;
  private readonly botUserId: string;

  /**
   * Creates a channel catalog.
   *
   * @param client - Discord access with the bot token.
   * @param botUserId - User id of the bot, which equals the application id.
   */
  public constructor(client: DiscordCatalogClient, botUserId: string) {
    this.client = client;
    this.botUserId = botUserId;
  }

  /**
   * Reads the channels of a server and checks the bot's permissions in each.
   *
   * @param guildId - Id of the verified server.
   * @returns The channels in the order of the server, or what went wrong.
   */
  public async list(
    guildId: string,
  ): Promise<DiscordCallResult<readonly DiscordChannelChoice[]>> {
    const [guild, channels, roleIds] = await Promise.all([
      this.client.getGuild(guildId),
      this.client.getChannels(guildId),
      this.client.getBotRoleIds(guildId),
    ]);

    if (!guild.ok) {
      return guild;
    }

    if (!channels.ok) {
      return channels;
    }

    if (!roleIds.ok) {
      return roleIds;
    }

    return {
      ok: true,
      value: channels.value.map((channel) =>
        toChoice(channel, guild.value, this.botUserId, roleIds.value),
      ),
    };
  }
}
