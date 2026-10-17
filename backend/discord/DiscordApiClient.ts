import { DISCORD_INSTALL_PERMISSIONS } from "@/backend/discord/DiscordPermissions";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import type { DiscordApplication } from "@/backend/discord/DiscordConfig";
import type {
  DiscordOverwrite,
  DiscordRole,
} from "@/backend/discord/DiscordPermissions";
import type { DiscordChannelKind, DiscordProblem } from "@/definition/Discord";

const API_BASE = "https://discord.com/api/v10";
const AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const REQUEST_TIMEOUT_MS = 10_000;
const MAXIMUM_RETRY_AFTER_SECONDS = 3_600;
const USER_AGENT = "DiscordBot (https://github.com/pages, 1.0)";

const CHANNEL_TYPES: Readonly<Record<number, DiscordChannelKind>> = {
  0: "text",
  5: "announcement",
};

/** Why a call to Discord did not succeed, as far as Pages tells the causes apart. */
export interface DiscordFailure {
  readonly problem: DiscordProblem;
  readonly status: number | null;
  /** Seconds Discord asks to wait; only set for a rate limit. */
  readonly retryAfterSeconds: number | null;
}

/** The outcome of one call: the value or the failure, never a thrown HTTP error. */
export type DiscordCallResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly failure: DiscordFailure };

/** A server as Discord describes it to the bot. */
export interface DiscordGuild {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly roles: readonly DiscordRole[];
}

/** A text or announcement channel of a server. */
export interface DiscordChannel {
  readonly id: string;
  readonly name: string;
  readonly kind: DiscordChannelKind;
  readonly position: number;
  readonly overwrites: readonly DiscordOverwrite[];
}

/** The body of a message Pages sends; it never allows a mention. */
export interface DiscordMessageBody {
  readonly content: string;
  readonly allowed_mentions: { readonly parse: readonly [] };
  /** `4` suppresses link previews, so the message stays short. */
  readonly flags: 4;
}

/** The part of `fetch` the client uses, so tests can stand in for Discord. */
export type DiscordFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

/**
 * Builds the official Discord install link of the bot.
 *
 * @param input - Application id, the exact redirect URI and the OAuth state.
 * @returns The authorization link with scope `bot`, the code grant and only
 * the permissions Pages needs; the QR code encodes exactly this link.
 */
export function buildAuthorizationUrl(input: {
  readonly applicationId: string;
  readonly redirectUri: string;
  readonly state: string;
}): string {
  const url = new URL(AUTHORIZE_URL);

  url.searchParams.set("client_id", input.applicationId);
  url.searchParams.set("scope", "bot");
  url.searchParams.set("permissions", DISCORD_INSTALL_PERMISSIONS);
  url.searchParams.set("integration_type", "0");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);

  return url.toString();
}

function failure(
  problem: DiscordProblem,
  status: number | null,
  retryAfterSeconds: number | null = null,
): DiscordCallResult<never> {
  return { failure: { problem, retryAfterSeconds, status }, ok: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (caughtError: unknown) {
    logCaughtError("DiscordApiClient", caughtError);

    return null;
  }
}

function readRetryAfter(response: Response, body: unknown): number {
  const header = Number(response.headers.get("retry-after"));
  const fromBody = isRecord(body) ? Number(body["retry_after"]) : Number.NaN;
  const seconds = Number.isFinite(header) && header > 0 ? header : fromBody;

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 1;
  }

  return Math.min(seconds, MAXIMUM_RETRY_AFTER_SECONDS);
}

function problemFromStatus(
  response: Response,
  body: unknown,
  missingProblem: DiscordProblem,
): DiscordCallResult<never> {
  const status = response.status;
  const code = isRecord(body) ? body["code"] : undefined;

  if (status === 429) {
    return failure("rate_limited", status, readRetryAfter(response, body));
  }

  if (status >= 500) {
    return failure("unavailable", status);
  }

  if (status === 401) {
    return failure("invalid_credentials", status);
  }

  if (code === 10003) {
    return failure("channel_missing", status);
  }

  if (code === 10004 || code === 10007) {
    return failure("bot_removed", status);
  }

  if (code === 50013) {
    return failure("missing_permissions", status);
  }

  if (status === 403) {
    return failure("missing_access", status);
  }

  return status === 404
    ? failure(missingProblem, status)
    : failure("unknown", status);
}

function parseRole(value: unknown): DiscordRole | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, permissions } = value;

  if (typeof id !== "string" || typeof permissions !== "string") {
    return null;
  }

  try {
    return { id, permissions: BigInt(permissions) };
  } catch (caughtError: unknown) {
    logCaughtError("DiscordApiClient", caughtError);

    return null;
  }
}

function parseOverwrite(value: unknown): DiscordOverwrite | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, type, allow, deny } = value;

  if (
    typeof id !== "string" ||
    (type !== 0 && type !== 1) ||
    typeof allow !== "string" ||
    typeof deny !== "string"
  ) {
    return null;
  }

  try {
    return { allow: BigInt(allow), deny: BigInt(deny), id, type };
  } catch (caughtError: unknown) {
    logCaughtError("DiscordApiClient", caughtError);

    return null;
  }
}

function parseGuild(body: unknown): DiscordGuild | null {
  if (!isRecord(body)) {
    return null;
  }

  const { id, name, owner_id: ownerId, roles } = body;

  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof ownerId !== "string" ||
    !Array.isArray(roles)
  ) {
    return null;
  }

  return {
    id,
    name,
    ownerId,
    roles: roles
      .map((role: unknown) => parseRole(role))
      .filter((role): role is DiscordRole => role !== null),
  };
}

function parseChannel(value: unknown): DiscordChannel | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, name, type, position, permission_overwrites: overwrites } = value;
  const kind = typeof type === "number" ? CHANNEL_TYPES[type] : undefined;

  if (typeof id !== "string" || typeof name !== "string" || !kind) {
    return null;
  }

  return {
    id,
    kind,
    name,
    overwrites: Array.isArray(overwrites)
      ? overwrites
          .map((overwrite: unknown) => parseOverwrite(overwrite))
          .filter(
            (overwrite): overwrite is DiscordOverwrite => overwrite !== null,
          )
      : [],
    position: typeof position === "number" ? position : 0,
  };
}

/**
 * Speaks to Discord's HTTP API with the bot token and the OAuth client secret.
 *
 * @remarks
 * Only `fetch` against the REST endpoints: no gateway connection, no privileged
 * intent and no `discord.js`, whose current major version needs a newer Node.js
 * than Pages supports. The credentials stay inside this class: they are sent
 * as headers and never put into a failure, a log line or a return value.
 */
export class DiscordApiClient {
  private readonly application: DiscordApplication;
  private readonly send: DiscordFetch;

  /**
   * Creates a Discord client.
   *
   * @param application - The instance's Discord application with its secrets.
   * @param send - HTTP function; defaults to the global `fetch`.
   */
  public constructor(
    application: DiscordApplication,
    send: DiscordFetch = (url, init) => fetch(url, init),
  ) {
    this.application = application;
    this.send = send;
  }

  /**
   * Exchanges the code of an OAuth callback and reads the server it names.
   *
   * @param code - Authorization code from the callback.
   * @param redirectUri - The redirect URI the authorization used.
   * @returns The id of the server the token response names, or `null` when the
   * response names none.
   */
  public async exchangeAuthorizationCode(
    code: string,
    redirectUri: string,
  ): Promise<DiscordCallResult<{ readonly guildId: string | null }>> {
    const credentials = Buffer.from(
      `${this.application.applicationId}:${this.application.clientSecret}`,
    ).toString("base64");
    const response = await this.request("/oauth2/token", {
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });

    if (!response.ok) {
      return response;
    }

    const body = response.value.body;
    const guild = isRecord(body) ? body["guild"] : undefined;
    const guildId =
      isRecord(guild) && typeof guild["id"] === "string" ? guild["id"] : null;

    return { ok: true, value: { guildId } };
  }

  /**
   * Reads a server with the bot token, which proves the bot is a member.
   *
   * @param guildId - Id of the server.
   * @returns The server with its roles and owner.
   */
  public async getGuild(
    guildId: string,
  ): Promise<DiscordCallResult<DiscordGuild>> {
    const response = await this.bot(
      `/guilds/${encodeURIComponent(guildId)}`,
      "bot_removed",
    );

    if (!response.ok) {
      return response;
    }

    const guild = parseGuild(response.value.body);

    return guild ? { ok: true, value: guild } : failure("unknown", null);
  }

  /**
   * Lists the text and announcement channels of a server.
   *
   * @param guildId - Id of the server.
   * @returns The channels with their permission overwrites, by position.
   */
  public async getChannels(
    guildId: string,
  ): Promise<DiscordCallResult<readonly DiscordChannel[]>> {
    const response = await this.bot(
      `/guilds/${encodeURIComponent(guildId)}/channels`,
      "bot_removed",
    );

    if (!response.ok) {
      return response;
    }

    const body = response.value.body;

    if (!Array.isArray(body)) {
      return failure("unknown", null);
    }

    const channels = body
      .map((channel: unknown) => parseChannel(channel))
      .filter((channel): channel is DiscordChannel => channel !== null)
      .sort(
        (first, second) =>
          first.position - second.position ||
          first.name.localeCompare(second.name),
      );

    return { ok: true, value: channels };
  }

  /**
   * Reads the role ids of the bot's own membership in a server.
   *
   * @param guildId - Id of the server.
   * @returns The ids of the roles the bot holds besides `@everyone`.
   */
  public async getBotRoleIds(
    guildId: string,
  ): Promise<DiscordCallResult<readonly string[]>> {
    const response = await this.bot(
      `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(this.application.applicationId)}`,
      "bot_removed",
    );

    if (!response.ok) {
      return response;
    }

    const roles = isRecord(response.value.body)
      ? response.value.body["roles"]
      : undefined;

    if (!Array.isArray(roles)) {
      return failure("unknown", null);
    }

    return {
      ok: true,
      value: roles.filter(
        (role: unknown): role is string => typeof role === "string",
      ),
    };
  }

  /**
   * Posts a message to a channel.
   *
   * @param channelId - Id of the channel.
   * @param message - Message body; mentions are disabled in it.
   * @param nonce - Stable per delivery, at most 25 characters. Discord does not
   * create a second message for a repeated nonce, so a retried delivery cannot
   * post twice.
   * @returns The id of the created message.
   */
  public async createMessage(
    channelId: string,
    message: DiscordMessageBody,
    nonce: string,
  ): Promise<DiscordCallResult<{ readonly messageId: string }>> {
    const response = await this.request(
      `/channels/${encodeURIComponent(channelId)}/messages`,
      {
        body: JSON.stringify({ ...message, enforce_nonce: true, nonce }),
        headers: {
          Authorization: `Bot ${this.application.botToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
      "channel_missing",
    );

    if (!response.ok) {
      return response;
    }

    const id = isRecord(response.value.body) ? response.value.body["id"] : null;

    return typeof id === "string"
      ? { ok: true, value: { messageId: id } }
      : failure("unknown", null);
  }

  private async bot(
    path: string,
    missingProblem: DiscordProblem,
  ): Promise<DiscordCallResult<{ readonly body: unknown }>> {
    return this.request(
      path,
      {
        headers: { Authorization: `Bot ${this.application.botToken}` },
        method: "GET",
      },
      missingProblem,
    );
  }

  private async request(
    path: string,
    init: RequestInit,
    missingProblem: DiscordProblem = "unknown",
  ): Promise<DiscordCallResult<{ readonly body: unknown }>> {
    try {
      const response = await this.send(`${API_BASE}${path}`, {
        ...init,
        headers: { ...init.headers, "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      logEvent({
        level: response.ok ? "debug" : "warn",
        event: "integration.discord.response",
        component: "DiscordApiClient",
        message: "Discord request finished",
        metadata: { statusCode: response.status },
      });
      const body = await readJson(response);

      return response.ok
        ? { ok: true, value: { body } }
        : problemFromStatus(response, body, missingProblem);
    } catch (caughtError: unknown) {
      logCaughtError("DiscordApiClient", caughtError);

      // The error of a failed call can name the request; only the fact is kept.
      return failure("unavailable", null);
    }
  }
}
