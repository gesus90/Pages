/** The events a project can send to its Discord channel (PAGE-27). */
export const DISCORD_EVENT_TYPES = [
  "ticket.created",
  "ticket.updated",
  "milestone.created",
  "milestone.updated",
] as const;

/** One event type of the Discord notifications. */
export type DiscordEventType = (typeof DISCORD_EVENT_TYPES)[number];

/**
 * Narrows an unknown value to an event type of the Discord notifications.
 *
 * @param value - Value received from an untrusted source.
 * @returns Whether the value names a supported event type.
 */
export function isDiscordEventType(value: unknown): value is DiscordEventType {
  return (
    typeof value === "string" &&
    (DISCORD_EVENT_TYPES as readonly string[]).includes(value)
  );
}

/** Which events of a project are switched on; every type is always present. */
export type DiscordEventSelection = Readonly<Record<DiscordEventType, boolean>>;

/** The selection a new connection starts with. */
export const DEFAULT_DISCORD_EVENTS: DiscordEventSelection = {
  "milestone.created": true,
  "milestone.updated": true,
  "ticket.created": true,
  "ticket.updated": true,
};

/**
 * The only Discord permissions Pages asks for and needs.
 *
 * @remarks
 * Sending a message to a text channel needs to see the channel and to send
 * in it. Reading messages, mentions of everyone, embeds, threads and every
 * privileged intent are not part of this feature.
 */
export const DISCORD_REQUIRED_PERMISSIONS = [
  "VIEW_CHANNEL",
  "SEND_MESSAGES",
] as const;

/** A Discord permission Pages checks on a channel. */
export type DiscordPermissionName =
  (typeof DISCORD_REQUIRED_PERMISSIONS)[number];

/** The kinds of channel that can receive notifications. */
export type DiscordChannelKind = "text" | "announcement";

/** Why a connection or a delivery does not work, in terms the interface explains. */
export type DiscordProblem =
  | "invalid_credentials"
  | "bot_removed"
  | "missing_access"
  | "missing_permissions"
  | "channel_missing"
  | "rate_limited"
  | "unavailable"
  | "unknown";

/** Whether the instance has the Discord application the feature needs. */
export interface DiscordInstanceStatus {
  readonly isConfigured: boolean;
  /**
   * Names of the environment variables that are still missing.
   *
   * @remarks
   * Only names; the values of the secrets never leave the server.
   */
  readonly missingSettings: readonly string[];
}

/** A text or announcement channel with the verdict of the permission check. */
export interface DiscordChannelChoice {
  readonly id: string;
  readonly name: string;
  readonly kind: DiscordChannelKind;
  /** The bot may see the channel and send in it. */
  readonly isSelectable: boolean;
  /** Permissions the bot lacks in this channel; empty for a selectable one. */
  readonly missing: readonly DiscordPermissionName[];
}

/** Counters of the stored deliveries of one project. */
export interface DiscordDeliverySummary {
  /** Messages still waiting for their first or next attempt. */
  readonly pending: number;
  /** Messages given up after the allowed attempts or a permanent error. */
  readonly failed: number;
  readonly lastSentAt: string | null;
  /** Problem of the most recent failed attempt that no later delivery cleared. */
  readonly lastProblem: DiscordProblem | null;
}

/** The Discord connection of one project, without any credential. */
export interface DiscordConnection {
  readonly projectId: string;
  readonly guildId: string;
  readonly guildName: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly events: DiscordEventSelection;
  readonly connectedAt: string;
  readonly updatedAt: string;
  readonly delivery: DiscordDeliverySummary;
}

/** How far a connection attempt has come. */
export type DiscordAttemptStatus =
  "pending" | "authorized" | "failed" | "expired" | "confirmed" | "cancelled";

/** Why Discord's side of an attempt did not succeed. */
export type DiscordAttemptFailure =
  "denied" | "no_guild" | "verification_failed" | "exchange_failed";

/** A connection attempt as the person who started it sees it. */
export interface DiscordAttempt {
  readonly id: string;
  readonly status: DiscordAttemptStatus;
  readonly expiresAt: string;
  /**
   * The official Discord authorization link; the QR code encodes exactly this.
   *
   * @remarks
   * Only present while the attempt waits for the authorization.
   */
  readonly authorizeUrl: string | null;
  /** The server Pages verified after the authorization. */
  readonly guild: { readonly id: string; readonly name: string } | null;
  readonly failure: DiscordAttemptFailure | null;
}

/** Everything the Discord panel of a project shows. */
export interface DiscordInterfaceState {
  readonly instance: DiscordInstanceStatus;
  /** Whether the visitor may connect, configure and disconnect. */
  readonly canManage: boolean;
  readonly connection: DiscordConnection | null;
  readonly attempt: DiscordAttempt | null;
  /**
   * Channels of the server to choose from, once there is a verified server.
   *
   * @remarks
   * `null` while there is no server to list channels of, or when Discord
   * could not be asked; then `channelsProblem` says why.
   */
  readonly channels: readonly DiscordChannelChoice[] | null;
  readonly channelsProblem: DiscordProblem | null;
}

/** Result of the test message. */
export interface DiscordTestResult {
  readonly isSent: boolean;
  readonly problem: DiscordProblem | null;
}

/** Reasons the Discord panel of a project reports for a refused request. */
export type DiscordActionErrorCode =
  | "not_configured"
  | "attempt_invalid"
  | "channel_unavailable"
  | "not_connected"
  | "invalid_events"
  | "discord_unavailable"
  | "invalid_input"
  | "forbidden"
  | "not_found"
  /** The request itself failed in the browser; the server never answered. */
  | "request_failed";

/** What the panel receives after loading it or changing something. */
export type DiscordActionResult =
  | {
      readonly ok: true;
      readonly state: DiscordInterfaceState;
      /** Set by the test message only. */
      readonly test: DiscordTestResult | null;
    }
  | { readonly ok: false; readonly error: DiscordActionErrorCode };
