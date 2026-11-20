import { expect, it } from "vitest";

import {
  computeChannelPermissions,
  DISCORD_INSTALL_PERMISSIONS,
  findMissingPermissions,
} from "./DiscordPermissions";

import type { DiscordPermissionInput } from "./DiscordPermissions";

const input: DiscordPermissionInput = {
  guildId: "guild",
  ownerId: "owner",
  botUserId: "bot",
  botRoleIds: ["role"],
  roles: [
    { id: "guild", permissions: 1024n },
    { id: "role", permissions: 2048n },
    { id: "other", permissions: 8n },
  ],
  overwrites: [],
};

it("grants owner and administrator permissions and reports required bits", () => {
  expect(DISCORD_INSTALL_PERMISSIONS).toBe("3072");
  expect(findMissingPermissions(computeChannelPermissions(input))).toEqual([]);
  expect(findMissingPermissions(0n)).toEqual(["VIEW_CHANNEL", "SEND_MESSAGES"]);
  expect(findMissingPermissions(1024n)).toEqual(["SEND_MESSAGES"]);
  expect(computeChannelPermissions({ ...input, ownerId: "bot" })).toBe(
    (1n << 64n) - 1n,
  );
  expect(
    computeChannelPermissions({
      ...input,
      roles: [{ id: "role", permissions: 8n }],
    }),
  ).toBe((1n << 64n) - 1n);
});

it("applies everyone, role and member overwrites in order", () => {
  const overwrites = [
    { id: "guild", type: 0 as const, deny: 2048n, allow: 0n },
    { id: "role", type: 0 as const, deny: 0n, allow: 2048n },
    { id: "other", type: 0 as const, deny: 1024n, allow: 0n },
    { id: "bot", type: 1 as const, deny: 2048n, allow: 0n },
    { id: "other", type: 1 as const, deny: 1024n, allow: 0n },
  ];
  expect(computeChannelPermissions({ ...input, overwrites })).toBe(1024n);
  expect(
    computeChannelPermissions({
      ...input,
      overwrites: [{ id: "guild", type: 0, deny: 1024n, allow: 0n }],
    }),
  ).toBe(0n);
});
