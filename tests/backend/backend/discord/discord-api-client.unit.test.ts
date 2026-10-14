import { expect, it, vi } from "vitest";

import { DiscordApiClient } from "@/backend/discord/DiscordApiClient";
import {
  describeDiscordInstance,
  readDiscordApplication,
  resolvePublicBaseUrl,
} from "@/backend/discord/DiscordConfig";

import { APPLICATION } from "../service/discord/fake-discord";

import type { DiscordFetch } from "@/backend/discord/DiscordApiClient";

const MESSAGE = {
  allowed_mentions: { parse: [] },
  content: "Hello",
  flags: 4,
} as const;

function client(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
): {
  readonly api: DiscordApiClient;
  readonly calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const send: DiscordFetch = async (url, init) => {
    calls.push({ init, url });

    return respond(url, init);
  };

  return { api: new DiscordApiClient(APPLICATION, send), calls };
}

function json(
  status: number,
  body: unknown,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), { headers, status });
}

it("sends the bot token only in the authorization header and a nonce with every message", async () => {
  const { api, calls } = client(() => json(200, { id: "m1" }));

  await expect(api.createMessage("201", MESSAGE, "nonce-1")).resolves.toEqual({
    ok: true,
    value: { messageId: "m1" },
  });

  const [call] = calls;
  const headers = new Headers(call?.init.headers);

  expect(call?.url).toBe("https://discord.com/api/v10/channels/201/messages");
  expect(headers.get("authorization")).toBe(`Bot ${APPLICATION.botToken}`);
  expect(headers.get("user-agent")).toMatch(/^DiscordBot /);
  expect(call?.url).not.toContain(APPLICATION.botToken);
  expect(String(call?.init.body)).not.toContain(APPLICATION.botToken);
  expect(JSON.parse(String(call?.init.body))).toEqual({
    ...MESSAGE,
    enforce_nonce: true,
    nonce: "nonce-1",
  });
});

it("reads Retry-After of a rate limit and falls back to the body", async () => {
  const header = client(() =>
    json(429, { retry_after: 9 }, { "retry-after": "2.5" }),
  );
  const body = client(() => json(429, { retry_after: 3.5 }));
  const neither = client(() => json(429, {}));
  const huge = client(() => json(429, {}, { "retry-after": "999999" }));

  await expect(
    header.api.createMessage("1", MESSAGE, "n"),
  ).resolves.toMatchObject({
    failure: { problem: "rate_limited", retryAfterSeconds: 2.5 },
    ok: false,
  });
  await expect(
    body.api.createMessage("1", MESSAGE, "n"),
  ).resolves.toMatchObject({
    failure: { retryAfterSeconds: 3.5 },
  });
  await expect(
    neither.api.createMessage("1", MESSAGE, "n"),
  ).resolves.toMatchObject({
    failure: { retryAfterSeconds: 1 },
  });
  await expect(
    huge.api.createMessage("1", MESSAGE, "n"),
  ).resolves.toMatchObject({
    failure: { retryAfterSeconds: 3_600 },
  });
});

it("names the cause of a refused message", async () => {
  const cases = [
    [401, {}, "invalid_credentials"],
    [403, { code: 50013 }, "missing_permissions"],
    [403, { code: 50001 }, "missing_access"],
    [404, { code: 10003 }, "channel_missing"],
    [404, {}, "channel_missing"],
    [500, {}, "unavailable"],
    [503, {}, "unavailable"],
    [400, {}, "unknown"],
  ] as const;

  for (const [status, body, problem] of cases) {
    const { api } = client(() => json(status, body));

    await expect(api.createMessage("1", MESSAGE, "n")).resolves.toMatchObject({
      failure: { problem, status },
      ok: false,
    });
  }
});

it("reports a failed connection without keeping the error that may name the request", async () => {
  const { api } = client(() => {
    throw new TypeError(`fetch failed for ${APPLICATION.botToken}`);
  });
  const result = await api.createMessage("1", MESSAGE, "n");

  expect(result).toEqual({
    failure: { problem: "unavailable", retryAfterSeconds: null, status: null },
    ok: false,
  });
  expect(JSON.stringify(result)).not.toContain(APPLICATION.botToken);
});

it("exchanges a code with the client credentials in the basic authorization header", async () => {
  const { api, calls } = client(() =>
    json(200, { access_token: "x", guild: { id: "300", name: "Team" } }),
  );

  await expect(
    api.exchangeAuthorizationCode(
      "the-code",
      "https://pages.example.test/discord/callback",
    ),
  ).resolves.toEqual({ ok: true, value: { guildId: "300" } });

  const [call] = calls;
  const credentials = Buffer.from(
    `${APPLICATION.applicationId}:${APPLICATION.clientSecret}`,
  ).toString("base64");

  expect(new Headers(call?.init.headers).get("authorization")).toBe(
    `Basic ${credentials}`,
  );
  expect(call?.url).not.toContain(APPLICATION.clientSecret);
  expect(
    Object.fromEntries(new URLSearchParams(String(call?.init.body))),
  ).toEqual({
    code: "the-code",
    grant_type: "authorization_code",
    redirect_uri: "https://pages.example.test/discord/callback",
  });
});

it("accepts a token response without a server and rejects an invalid code", async () => {
  const none = client(() => json(200, { access_token: "x" }));
  const invalid = client(() => json(400, { error: "invalid_grant" }));

  await expect(none.api.exchangeAuthorizationCode("c", "r")).resolves.toEqual({
    ok: true,
    value: { guildId: null },
  });
  await expect(
    invalid.api.exchangeAuthorizationCode("c", "r"),
  ).resolves.toMatchObject({
    failure: { problem: "unknown", status: 400 },
    ok: false,
  });
});

it("reads the server, its text channels and the bot roles", async () => {
  const { api } = client((url) => {
    if (url.endsWith("/guilds/300")) {
      return json(200, {
        id: "300",
        name: "Team",
        owner_id: "7",
        roles: [
          { id: "300", permissions: "0" },
          { id: "bot", permissions: "3072" },
          { id: "broken", permissions: "not-a-number" },
        ],
      });
    }

    if (url.endsWith("/channels")) {
      return json(200, [
        { id: "2", name: "b", permission_overwrites: [], position: 2, type: 0 },
        {
          id: "1",
          name: "a",
          permission_overwrites: [
            { allow: "0", deny: "2048", id: "bot", type: 0 },
            { allow: "x", deny: "0", id: "bad", type: 0 },
          ],
          position: 1,
          type: 5,
        },
        {
          id: "3",
          name: "voice",
          permission_overwrites: [],
          position: 3,
          type: 2,
        },
        { id: "4", name: "category", position: 0, type: 4 },
      ]);
    }

    return json(200, { roles: ["bot", 5] });
  });

  const guild = await api.getGuild("300");
  const channels = await api.getChannels("300");
  const roles = await api.getBotRoleIds("300");

  expect(guild).toMatchObject({
    ok: true,
    value: {
      id: "300",
      ownerId: "7",
      roles: [
        { id: "300", permissions: 0n },
        { id: "bot", permissions: 3072n },
      ],
    },
  });
  expect(channels).toMatchObject({
    ok: true,
    value: [
      {
        id: "1",
        kind: "announcement",
        overwrites: [{ deny: 2048n, id: "bot" }],
      },
      { id: "2", kind: "text", overwrites: [] },
    ],
  });
  expect(roles).toEqual({ ok: true, value: ["bot"] });
});

it("treats a malformed answer as an unknown problem", async () => {
  const { api } = client(() => json(200, { unexpected: true }));

  await expect(api.getGuild("300")).resolves.toMatchObject({
    failure: { problem: "unknown" },
    ok: false,
  });
  await expect(api.getChannels("300")).resolves.toMatchObject({ ok: false });
  await expect(api.getBotRoleIds("300")).resolves.toMatchObject({ ok: false });
  await expect(api.createMessage("1", MESSAGE, "n")).resolves.toMatchObject({
    ok: false,
  });
});

it("recognises a bot that is no longer on the server", async () => {
  const { api } = client(() => json(404, { code: 10004 }));

  await expect(api.getGuild("300")).resolves.toMatchObject({
    failure: { problem: "bot_removed" },
  });
});

it("reads the application from the environment and names what is missing, never a value", () => {
  const complete = {
    PAGES_DISCORD_APPLICATION_ID: "111111111111111111",
    PAGES_DISCORD_BOT_TOKEN: "token",
    PAGES_DISCORD_CLIENT_SECRET: "secret",
  };

  expect(readDiscordApplication(complete)).toEqual({
    applicationId: "111111111111111111",
    botToken: "token",
    clientSecret: "secret",
  });
  expect(describeDiscordInstance(complete)).toEqual({
    isConfigured: true,
    missingSettings: [],
  });
  expect(readDiscordApplication({})).toBeNull();
  expect(describeDiscordInstance({})).toEqual({
    isConfigured: false,
    missingSettings: [
      "PAGES_DISCORD_APPLICATION_ID",
      "PAGES_DISCORD_CLIENT_SECRET",
      "PAGES_DISCORD_BOT_TOKEN",
    ],
  });

  const malformed = describeDiscordInstance({
    ...complete,
    PAGES_DISCORD_APPLICATION_ID: "not a number",
    PAGES_DISCORD_BOT_TOKEN: "two words",
  });

  expect(malformed.missingSettings).toEqual([
    "PAGES_DISCORD_APPLICATION_ID",
    "PAGES_DISCORD_BOT_TOKEN",
  ]);
  expect(JSON.stringify(malformed)).not.toContain("secret");
});

it("uses the configured public address and falls back to the request origin", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  expect(
    resolvePublicBaseUrl("http://127.0.0.1:3000", {
      PAGES_PUBLIC_URL: "https://pages.example.com/some/path/",
    }),
  ).toBe("https://pages.example.com");
  expect(resolvePublicBaseUrl("http://127.0.0.1:3000/x?y=1", {})).toBe(
    "http://127.0.0.1:3000",
  );
  expect(
    resolvePublicBaseUrl("http://127.0.0.1:3000", {
      PAGES_PUBLIC_URL: "ftp://x",
    }),
  ).toBe("http://127.0.0.1:3000");
  expect(
    resolvePublicBaseUrl("http://127.0.0.1:3000", {
      PAGES_PUBLIC_URL: "nonsense",
    }),
  ).toBe("http://127.0.0.1:3000");
  expect(warn).toHaveBeenCalledTimes(1);
});
