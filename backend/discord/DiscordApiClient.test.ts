import { expect, it, vi } from "vitest";

import { buildAuthorizationUrl, DiscordApiClient } from "./DiscordApiClient";

import type { DiscordFetch, DiscordMessageBody } from "./DiscordApiClient";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

const application = {
  applicationId: "12345",
  clientSecret: "secret",
  botToken: "token",
};
const message: DiscordMessageBody = {
  content: "hello",
  allowed_mentions: { parse: [] },
  flags: 4,
};

function clientFor(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): DiscordApiClient {
  return new DiscordApiClient(
    application,
    async () => new Response(JSON.stringify(body), { status, headers }),
  );
}

it("builds OAuth URLs and exchanges authorization codes", async () => {
  const url = new URL(
    buildAuthorizationUrl({
      applicationId: "12345",
      redirectUri: "https://example.com/callback",
      state: "state",
    }),
  );
  expect(url.searchParams.get("permissions")).toBe("3072");
  expect(url.searchParams.get("redirect_uri")).toBe(
    "https://example.com/callback",
  );
  const send = vi.fn<DiscordFetch>(
    async () => new Response(JSON.stringify({ guild: { id: "g" } })),
  );
  const client = new DiscordApiClient(application, send);
  expect(
    await client.exchangeAuthorizationCode("code", "https://example.com"),
  ).toEqual({ ok: true, value: { guildId: "g" } });
  expect(send.mock.calls[0]?.[1].method).toBe("POST");
  expect(
    await clientFor({ guild: {} }).exchangeAuthorizationCode("code", "url"),
  ).toEqual({ ok: true, value: { guildId: null } });
  expect(
    await clientFor(null).exchangeAuthorizationCode("code", "url"),
  ).toEqual({ ok: true, value: { guildId: null } });
  expect(
    (await clientFor({}, 401).exchangeAuthorizationCode("code", "url")).ok,
  ).toBe(false);
});

it("parses guild roles and rejects malformed guilds", async () => {
  const guild = {
    id: "g",
    name: "Guild",
    owner_id: "owner",
    roles: [
      { id: "r", permissions: "1024" },
      null,
      {},
      { id: 1, permissions: "1" },
      { id: "r", permissions: 1 },
      { id: "bad", permissions: "bad" },
    ],
  };
  expect(await clientFor(guild).getGuild("g")).toEqual({
    ok: true,
    value: {
      id: "g",
      name: "Guild",
      ownerId: "owner",
      roles: [{ id: "r", permissions: 1024n }],
    },
  });
  for (const body of [
    null,
    {},
    { ...guild, name: 1 },
    { ...guild, owner_id: 1 },
    { ...guild, roles: {} },
  ]) {
    expect((await clientFor(body).getGuild("g")).ok).toBe(false);
  }
  expect((await clientFor({}, 404).getGuild("g")).ok).toBe(false);
});

it("filters and orders channels and validates overwrites", async () => {
  const channel = {
    id: "c",
    name: "Channel",
    type: 0,
    position: 2,
    permission_overwrites: [
      { id: "g", type: 0, allow: "1", deny: "2" },
      null,
      {},
      { id: 1, type: 0, allow: "1", deny: "2" },
      { id: "x", type: 3, allow: "1", deny: "2" },
      { id: "x", type: 1, allow: 1, deny: "2" },
      { id: "x", type: 1, allow: "1", deny: 2 },
      { id: "x", type: 1, allow: "bad", deny: "2" },
    ],
  };
  const body = [
    channel,
    { id: "b", name: "B", type: 5 },
    { id: "a", name: "A", type: 0 },
    null,
    {},
    { ...channel, id: 1 },
    { ...channel, name: 1 },
    { ...channel, type: 2 },
    { ...channel, type: "0" },
  ];
  const result = await clientFor(body).getChannels("g");
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(result.value[2]?.overwrites).toEqual([
      { id: "g", type: 0, allow: 1n, deny: 2n },
    ]);
  }
  expect((await clientFor({}).getChannels("g")).ok).toBe(false);
  expect((await clientFor({}, 403).getChannels("g")).ok).toBe(false);
});

it("reads role ids and posts messages with stable nonces", async () => {
  expect(await clientFor({ roles: ["a", 1] }).getBotRoleIds("g")).toEqual({
    ok: true,
    value: ["a"],
  });
  expect((await clientFor(null).getBotRoleIds("g")).ok).toBe(false);
  expect((await clientFor({ roles: {} }).getBotRoleIds("g")).ok).toBe(false);
  expect((await clientFor({}, 403).getBotRoleIds("g")).ok).toBe(false);
  const send = vi.fn<DiscordFetch>(
    async () => new Response(JSON.stringify({ id: "m" })),
  );
  const client = new DiscordApiClient(application, send);
  expect(await client.createMessage("channel/1", message, "nonce")).toEqual({
    ok: true,
    value: { messageId: "m" },
  });
  expect(send.mock.calls[0]?.[0]).toContain("channel%2F1");
  expect(JSON.parse(String(send.mock.calls[0]?.[1].body))).toMatchObject({
    nonce: "nonce",
    enforce_nonce: true,
  });
  expect((await clientFor(null).createMessage("c", message, "n")).ok).toBe(
    false,
  );
  expect((await clientFor({}, 404).createMessage("c", message, "n")).ok).toBe(
    false,
  );
});

it("maps Discord failures and bounds retry delays", async () => {
  const cases = [
    { status: 401, body: {}, problem: "invalid_credentials" },
    { status: 500, body: {}, problem: "unavailable" },
    { status: 400, body: { code: 10003 }, problem: "channel_missing" },
    { status: 400, body: { code: 10004 }, problem: "bot_removed" },
    { status: 400, body: { code: 10007 }, problem: "bot_removed" },
    { status: 400, body: { code: 50013 }, problem: "missing_permissions" },
    { status: 403, body: {}, problem: "missing_access" },
    { status: 404, body: {}, problem: "bot_removed" },
    { status: 400, body: [], problem: "unknown" },
  ];
  for (const entry of cases) {
    expect(await clientFor(entry.body, entry.status).getGuild("g")).toEqual({
      ok: false,
      failure: {
        problem: entry.problem,
        status: entry.status,
        retryAfterSeconds: null,
      },
    });
  }
  for (const [body, headers, delay] of [
    [{ retry_after: 5 }, {}, 5],
    [{ retry_after: 5 }, { "retry-after": "2" }, 2],
    [{ retry_after: 9999 }, {}, 3600],
    [null, {}, 1],
    [{ retry_after: -1 }, {}, 1],
  ] as const) {
    expect(await clientFor(body, 429, headers).getGuild("g")).toEqual({
      ok: false,
      failure: {
        problem: "rate_limited",
        status: 429,
        retryAfterSeconds: delay,
      },
    });
  }
});

it("handles malformed JSON and network failures without leaking errors", async () => {
  const badJson = new DiscordApiClient(
    application,
    async () => new Response("not json", { status: 400 }),
  );
  expect((await badJson.getGuild("g")).ok).toBe(false);
  const network = new DiscordApiClient(application, async () => {
    throw new Error("secret");
  });
  expect(await network.getGuild("g")).toEqual({
    ok: false,
    failure: { problem: "unavailable", status: null, retryAfterSeconds: null },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ id: "m" }))),
  );
  expect(
    (await new DiscordApiClient(application).createMessage("c", message, "n"))
      .ok,
  ).toBe(true);
});
