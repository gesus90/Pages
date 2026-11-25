import { describe, expect, it, vi } from "vitest";

import { DiscordChannelCatalog } from "./DiscordChannelCatalog";

import type {
  DiscordChannel,
  DiscordFailure,
  DiscordGuild,
} from "@/backend/discord/DiscordApiClient";

const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const BOT_USER_ID = "bot";
const FAILURE: DiscordFailure = {
  problem: "unavailable",
  retryAfterSeconds: null,
  status: 503,
};

const guild: DiscordGuild = {
  id: "g1",
  name: "Guild",
  ownerId: "owner",
  roles: [{ id: "g1", permissions: VIEW_CHANNEL | SEND_MESSAGES }],
};

function channel(id: string, deny: bigint): DiscordChannel {
  return {
    id,
    kind: "text",
    name: `channel-${id}`,
    overwrites: [{ allow: 0n, deny, id: "g1", type: 0 }],
    position: 0,
  };
}

function createCatalog(results: {
  readonly guild?: unknown;
  readonly channels?: unknown;
  readonly roleIds?: unknown;
}): DiscordChannelCatalog {
  return new DiscordChannelCatalog(
    {
      getBotRoleIds: vi
        .fn()
        .mockResolvedValue(results.roleIds ?? { ok: true, value: [] }),
      getChannels: vi
        .fn()
        .mockResolvedValue(results.channels ?? { ok: true, value: [] }),
      getGuild: vi
        .fn()
        .mockResolvedValue(results.guild ?? { ok: true, value: guild }),
    },
    BOT_USER_ID,
  );
}

describe("DiscordChannelCatalog.list", () => {
  it("marks channels by the permissions the bot has in them", async () => {
    const catalog = createCatalog({
      channels: {
        ok: true,
        value: [channel("open", 0n), channel("muted", SEND_MESSAGES)],
      },
    });

    const result = await catalog.list("g1");

    expect(result).toEqual({
      ok: true,
      value: [
        {
          id: "open",
          isSelectable: true,
          kind: "text",
          missing: [],
          name: "channel-open",
        },
        {
          id: "muted",
          isSelectable: false,
          kind: "text",
          missing: ["SEND_MESSAGES"],
          name: "channel-muted",
        },
      ],
    });
  });

  it("returns the failure of the server lookup", async () => {
    const failure = { failure: FAILURE, ok: false };

    expect(await createCatalog({ guild: failure }).list("g1")).toBe(failure);
  });

  it("returns the failure of the channel lookup", async () => {
    const failure = { failure: FAILURE, ok: false };

    expect(await createCatalog({ channels: failure }).list("g1")).toBe(failure);
  });

  it("returns the failure of the role lookup", async () => {
    const failure = { failure: FAILURE, ok: false };

    expect(await createCatalog({ roleIds: failure }).list("g1")).toBe(failure);
  });
});
