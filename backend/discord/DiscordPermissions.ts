import { DISCORD_REQUIRED_PERMISSIONS } from "@/definition/Discord";

import type { DiscordPermissionName } from "@/definition/Discord";

const PERMISSION_BITS: Readonly<Record<DiscordPermissionName, bigint>> = {
  SEND_MESSAGES: 1n << 11n,
  VIEW_CHANNEL: 1n << 10n,
};

const ADMINISTRATOR = 1n << 3n;

/**
 * The permission integer of the install link: View Channel and Send Messages.
 *
 * @remarks
 * Nothing else is requested, so the invited bot cannot read messages, mention
 * everyone, manage anything or join voice.
 */
export const DISCORD_INSTALL_PERMISSIONS: string =
  DISCORD_REQUIRED_PERMISSIONS.reduce(
    (sum, name) => sum | PERMISSION_BITS[name],
    0n,
  ).toString();

/** A role of a server with its server-wide permissions. */
export interface DiscordRole {
  readonly id: string;
  readonly permissions: bigint;
}

/** A permission overwrite of a channel for a role (`0`) or a member (`1`). */
export interface DiscordOverwrite {
  readonly id: string;
  readonly type: 0 | 1;
  readonly allow: bigint;
  readonly deny: bigint;
}

/** What the permission computation of the bot in one channel needs. */
export interface DiscordPermissionInput {
  /** The server id, which is also the id of its `@everyone` role. */
  readonly guildId: string;
  readonly ownerId: string;
  readonly botUserId: string;
  readonly botRoleIds: readonly string[];
  readonly roles: readonly DiscordRole[];
  readonly overwrites: readonly DiscordOverwrite[];
}

const EVERY_PERMISSION = (1n << 64n) - 1n;

function applyOverwrite(
  permissions: bigint,
  overwrite: Pick<DiscordOverwrite, "allow" | "deny">,
): bigint {
  return (permissions & ~overwrite.deny) | overwrite.allow;
}

function baseServerPermissions(input: DiscordPermissionInput): bigint {
  const roleIds = new Set([input.guildId, ...input.botRoleIds]);

  return input.roles
    .filter((role) => roleIds.has(role.id))
    .reduce((sum, role) => sum | role.permissions, 0n);
}

function applyChannelOverwrites(
  base: bigint,
  input: DiscordPermissionInput,
): bigint {
  const everyone = input.overwrites.find(
    (overwrite) => overwrite.type === 0 && overwrite.id === input.guildId,
  );
  const roleIds = new Set(input.botRoleIds);
  const ownRoles = input.overwrites.filter(
    (overwrite) =>
      overwrite.type === 0 &&
      overwrite.id !== input.guildId &&
      roleIds.has(overwrite.id),
  );
  const member = input.overwrites.find(
    (overwrite) => overwrite.type === 1 && overwrite.id === input.botUserId,
  );

  let permissions = everyone ? applyOverwrite(base, everyone) : base;

  // Role overwrites apply together: every deny first, then every allow.
  permissions = applyOverwrite(permissions, {
    allow: ownRoles.reduce((sum, overwrite) => sum | overwrite.allow, 0n),
    deny: ownRoles.reduce((sum, overwrite) => sum | overwrite.deny, 0n),
  });

  return member ? applyOverwrite(permissions, member) : permissions;
}

/**
 * Computes the permissions the bot has in one channel.
 *
 * @param input - Server, bot roles and the overwrites of the channel.
 * @returns The effective permission bits, following Discord's documented order:
 * owner and administrator hold everything, then `@everyone`, the bot's roles
 * and the bot's own overwrite apply in turn.
 */
export function computeChannelPermissions(
  input: DiscordPermissionInput,
): bigint {
  if (input.ownerId === input.botUserId) {
    return EVERY_PERMISSION;
  }

  const base = baseServerPermissions(input);

  if ((base & ADMINISTRATOR) === ADMINISTRATOR) {
    return EVERY_PERMISSION;
  }

  const permissions = applyChannelOverwrites(base, input);

  // A channel the bot cannot see offers it nothing else.
  return (permissions & PERMISSION_BITS.VIEW_CHANNEL) === 0n ? 0n : permissions;
}

/**
 * Lists which of the required permissions are not part of the given ones.
 *
 * @param permissions - Effective permission bits in a channel.
 * @returns The missing required permissions; empty when the bot can post.
 */
export function findMissingPermissions(
  permissions: bigint,
): DiscordPermissionName[] {
  return DISCORD_REQUIRED_PERMISSIONS.filter(
    (name) => (permissions & PERMISSION_BITS[name]) === 0n,
  );
}
