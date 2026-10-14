import type { DiscordFetch } from "@/backend/discord/DiscordApiClient";

/** The secrets of the synthetic Discord application. */
export const APPLICATION = {
  applicationId: "111111111111111111",
  botToken: "synthetic-bot-token",
  clientSecret: "synthetic-client-secret",
} as const;

/** A permission overwrite as the channel list returns it. */
export interface FakeOverwrite {
  readonly id: string;
  readonly type: 0 | 1;
  readonly allow: string;
  readonly deny: string;
}

/** A channel of a synthetic server. */
export interface FakeChannel {
  readonly id: string;
  readonly name: string;
  /** 0 text, 5 announcement, 2 voice. */
  readonly type: number;
  readonly position: number;
  readonly overwrites: readonly FakeOverwrite[];
  /** The truth the message endpoint applies, independent of the overwrites. */
  readonly botMaySend: boolean;
}

/** A synthetic Discord server. */
export interface FakeGuild {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly roles: readonly {
    readonly id: string;
    readonly permissions: string;
  }[];
  readonly botRoleIds: readonly string[];
  readonly channels: readonly FakeChannel[];
  /** Whether the bot is a member; without it every bot call is refused. */
  readonly hasBot: boolean;
}

/** One message the synthetic Discord accepted. */
export interface SentMessage {
  readonly id: string;
  readonly channelId: string;
  readonly content: string;
  readonly allowedMentions: unknown;
  readonly flags: unknown;
  readonly nonce: unknown;
}

/** One request the synthetic Discord received. */
export interface ReceivedRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | null;
  readonly body: string;
}

/** A scripted answer that replaces the next real one of an endpoint. */
export interface ScriptedAnswer {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

const BASE = "https://discord.com/api/v10";
const BOT_AUTHORIZATION = `Bot ${APPLICATION.botToken}`;

function answer(
  status: number,
  body: unknown,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
    status,
  });
}

function missingAccess(): Response {
  return answer(403, { code: 50001, message: "Missing Access" });
}

function readFields(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);

  return typeof parsed === "object" && parsed !== null
    ? Object.fromEntries(Object.entries(parsed))
    : {};
}

/** Builds a text channel in which the bot may post. */
export function textChannel(
  id: string,
  name: string,
  overrides: Partial<FakeChannel> = {},
): FakeChannel {
  return {
    botMaySend: true,
    id,
    name,
    overwrites: [],
    position: Number(id),
    type: 0,
    ...overrides,
  };
}

/**
 * A synthetic Discord REST API: token exchange, server, channels, bot member
 * and message creation with the nonce rule.
 *
 * @remarks
 * It checks the credentials the way Discord does and records every request,
 * so tests can assert that no secret travels anywhere but its header.
 */
export class FakeDiscord {
  public readonly guilds = new Map<string, FakeGuild>();
  public readonly codes = new Map<string, string>();
  public readonly messages: SentMessage[] = [];
  public readonly requests: ReceivedRequest[] = [];
  public readonly scripted: ScriptedAnswer[] = [];
  public isDown = false;
  /** Runs while a request is being answered, as a slow Discord lets other things happen. */
  public duringRequest: ((url: string) => Promise<void>) | null = null;
  /** Creates the next message but loses the answer, as a dropped connection does. */
  public loseNextMessageResponse = false;
  private readonly nonces = new Map<string, SentMessage>();
  private nextMessageNumber = 1;

  /** The transport the Discord client sends through. */
  public readonly fetch: DiscordFetch = async (url, init) => {
    const body = init.body === undefined ? "" : String(init.body);
    const headers = new Headers(init.headers);

    this.requests.push({
      authorization: headers.get("authorization"),
      body,
      method: init.method ?? "GET",
      url,
    });

    if (this.isDown) {
      throw new TypeError("fetch failed");
    }

    await this.duringRequest?.(url);

    const scripted = this.scripted.shift();

    if (scripted) {
      return answer(scripted.status, scripted.body ?? {}, scripted.headers);
    }

    const response = this.route(url.slice(BASE.length), init.method ?? "GET", {
      authorization: headers.get("authorization"),
      body,
    });

    if (
      this.loseNextMessageResponse &&
      response.ok &&
      url.endsWith("/messages")
    ) {
      this.loseNextMessageResponse = false;

      throw new TypeError("fetch failed");
    }

    return response;
  };

  /** Adds a server the bot is a member of, with a text channel unless given. */
  public addGuild(
    guild: Partial<FakeGuild> & { readonly id: string },
  ): FakeGuild {
    const created: FakeGuild = {
      botRoleIds: ["bot-role"],
      channels: [textChannel("201", "general")],
      hasBot: true,
      name: `Server ${guild.id}`,
      ownerId: "999999999999999999",
      roles: [
        { id: guild.id, permissions: "0" },
        { id: "bot-role", permissions: "3072" },
      ],
      ...guild,
    };

    this.guilds.set(created.id, created);

    return created;
  }

  /** Lets a code succeed once and name the given server. */
  public grantCode(code: string, guildId: string): void {
    this.codes.set(code, guildId);
  }

  private route(
    path: string,
    method: string,
    request: { readonly authorization: string | null; readonly body: string },
  ): Response {
    if (path === "/oauth2/token") {
      return this.exchange(request);
    }

    if (request.authorization !== BOT_AUTHORIZATION) {
      return answer(401, { code: 0, message: "401: Unauthorized" });
    }

    const segments = path.split("/").filter(Boolean);

    if (method === "POST" && segments[0] === "channels") {
      return this.createMessage(segments[1] ?? "", request.body);
    }

    const guild = this.guilds.get(segments[1] ?? "");

    if (segments[0] !== "guilds" || !guild) {
      return answer(404, { code: 10004, message: "Unknown Guild" });
    }

    return guild.hasBot ? this.readGuild(guild, segments) : missingAccess();
  }

  private exchange(request: {
    readonly authorization: string | null;
    readonly body: string;
  }): Response {
    const expected = Buffer.from(
      `${APPLICATION.applicationId}:${APPLICATION.clientSecret}`,
    ).toString("base64");

    if (request.authorization !== `Basic ${expected}`) {
      return answer(401, { error: "invalid_client" });
    }

    const parameters = new URLSearchParams(request.body);
    const code = parameters.get("code") ?? "";
    const guildId = this.codes.get(code);

    if (
      parameters.get("grant_type") !== "authorization_code" ||
      guildId === undefined
    ) {
      return answer(400, { error: "invalid_grant" });
    }

    this.codes.delete(code);

    return answer(200, {
      access_token: "synthetic-access-token",
      guild: { id: guildId, name: this.guilds.get(guildId)?.name ?? "" },
      token_type: "Bearer",
    });
  }

  private readGuild(guild: FakeGuild, segments: readonly string[]): Response {
    if (segments.length === 2) {
      return answer(200, {
        id: guild.id,
        name: guild.name,
        owner_id: guild.ownerId,
        roles: guild.roles,
      });
    }

    if (segments[2] === "channels") {
      return answer(
        200,
        guild.channels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          permission_overwrites: channel.overwrites,
          position: channel.position,
          type: channel.type,
        })),
      );
    }

    return segments[2] === "members" &&
      segments[3] === APPLICATION.applicationId
      ? answer(200, { roles: guild.botRoleIds })
      : answer(404, { code: 10007, message: "Unknown Member" });
  }

  private createMessage(channelId: string, rawBody: string): Response {
    const channel = [...this.guilds.values()]
      .flatMap((guild) => guild.channels)
      .find((candidate) => candidate.id === channelId);

    if (!channel) {
      return answer(404, { code: 10003, message: "Unknown Channel" });
    }

    if (!channel.botMaySend) {
      return answer(403, { code: 50013, message: "Missing Permissions" });
    }

    const parsed = readFields(rawBody);
    const nonce = String(parsed["nonce"]);
    const known = this.nonces.get(`${channelId}:${nonce}`);

    // Discord answers a repeated nonce with the first message and creates no second.
    if (parsed["enforce_nonce"] === true && known) {
      return answer(200, { id: known.id });
    }

    const message: SentMessage = {
      allowedMentions: parsed["allowed_mentions"],
      channelId,
      content: String(parsed["content"]),
      flags: parsed["flags"],
      id: `message-${this.nextMessageNumber}`,
      nonce: parsed["nonce"],
    };

    this.nextMessageNumber += 1;
    this.messages.push(message);
    this.nonces.set(`${channelId}:${nonce}`, message);

    return answer(200, { id: message.id });
  }
}
