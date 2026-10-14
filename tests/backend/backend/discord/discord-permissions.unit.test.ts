import { expect, it } from "vitest";

import {
  computeChannelPermissions,
  DISCORD_INSTALL_PERMISSIONS,
  findMissingPermissions,
} from "@/backend/discord/DiscordPermissions";

import type { DiscordPermissionInput } from "@/backend/discord/DiscordPermissions";

const VIEW = 1n << 10n;
const SEND = 1n << 11n;
const ADMINISTRATOR = 1n << 3n;

function input(
  overrides: Partial<DiscordPermissionInput>,
): DiscordPermissionInput {
  return {
    botRoleIds: ["bot"],
    botUserId: "42",
    guildId: "1",
    overwrites: [],
    ownerId: "7",
    roles: [
      { id: "1", permissions: 0n },
      { id: "bot", permissions: VIEW | SEND },
    ],
    ...overrides,
  };
}

it("requests exactly View Channel and Send Messages", () => {
  expect(DISCORD_INSTALL_PERMISSIONS).toBe("3072");
  expect(BigInt(DISCORD_INSTALL_PERMISSIONS)).toBe(VIEW | SEND);
});

it("grants what the roles of the bot grant", () => {
  const permissions = computeChannelPermissions(input({}));

  expect(findMissingPermissions(permissions)).toEqual([]);
});

it("misses both permissions without a role that grants them", () => {
  const permissions = computeChannelPermissions(
    input({ botRoleIds: [], roles: [{ id: "1", permissions: 0n }] }),
  );

  expect(findMissingPermissions(permissions)).toEqual([
    "VIEW_CHANNEL",
    "SEND_MESSAGES",
  ]);
});

it("takes the permissions of @everyone into account", () => {
  const permissions = computeChannelPermissions(
    input({
      botRoleIds: [],
      roles: [{ id: "1", permissions: VIEW | SEND }],
    }),
  );

  expect(findMissingPermissions(permissions)).toEqual([]);
});

it("lets the owner and an administrator do everything", () => {
  const owner = computeChannelPermissions(
    input({ botRoleIds: [], ownerId: "42", roles: [] }),
  );
  const administrator = computeChannelPermissions(
    input({
      overwrites: [{ allow: 0n, deny: VIEW | SEND, id: "1", type: 0 }],
      roles: [
        { id: "1", permissions: 0n },
        { id: "bot", permissions: ADMINISTRATOR },
      ],
    }),
  );

  expect(findMissingPermissions(owner)).toEqual([]);
  expect(findMissingPermissions(administrator)).toEqual([]);
});

it("applies the overwrite of @everyone before the overwrites of roles and of the member", () => {
  const denyThenAllow = computeChannelPermissions(
    input({
      overwrites: [
        { allow: 0n, deny: SEND, id: "1", type: 0 },
        { allow: SEND, deny: 0n, id: "bot", type: 0 },
      ],
    }),
  );
  const memberDenies = computeChannelPermissions(
    input({
      overwrites: [
        { allow: SEND, deny: 0n, id: "bot", type: 0 },
        { allow: 0n, deny: SEND, id: "42", type: 1 },
      ],
    }),
  );

  expect(findMissingPermissions(denyThenAllow)).toEqual([]);
  expect(findMissingPermissions(memberDenies)).toEqual(["SEND_MESSAGES"]);
});

it("ignores overwrites of roles and members that are not the bot", () => {
  const permissions = computeChannelPermissions(
    input({
      overwrites: [
        { allow: 0n, deny: SEND, id: "other-role", type: 0 },
        { allow: 0n, deny: SEND, id: "99", type: 1 },
      ],
    }),
  );

  expect(findMissingPermissions(permissions)).toEqual([]);
});

it("treats a channel the bot cannot see as offering nothing", () => {
  const permissions = computeChannelPermissions(
    input({ overwrites: [{ allow: 0n, deny: VIEW, id: "bot", type: 0 }] }),
  );

  expect(permissions).toBe(0n);
  expect(findMissingPermissions(permissions)).toEqual([
    "VIEW_CHANNEL",
    "SEND_MESSAGES",
  ]);
});

it("names only the permission that is missing", () => {
  const permissions = computeChannelPermissions(
    input({
      roles: [
        { id: "1", permissions: 0n },
        { id: "bot", permissions: VIEW },
      ],
    }),
  );

  expect(findMissingPermissions(permissions)).toEqual(["SEND_MESSAGES"]);
});
