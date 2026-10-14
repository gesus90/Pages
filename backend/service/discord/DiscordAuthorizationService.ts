import { createHash, randomBytes, randomUUID } from "node:crypto";

import { buildAuthorizationUrl } from "@/backend/discord/DiscordApiClient";
import { DiscordError } from "@/backend/error/DiscordErrors";

import type {
  DiscordApiClient,
  DiscordFailure,
} from "@/backend/discord/DiscordApiClient";
import type { DiscordApplication } from "@/backend/discord/DiscordConfig";
import type {
  DiscordAttemptRecord,
  DiscordAttemptStore,
} from "@/backend/database/repositories/discord/DiscordAttemptRepository";
import type {
  DiscordAttempt,
  DiscordAttemptFailure,
} from "@/definition/Discord";

/** Where Discord sends the browser after the authorization, relative to the public address. */
export const DISCORD_CALLBACK_PATH = "/discord/callback";

/** How long a connection attempt lives; it covers the scan, the consent and the confirmation. */
export const ATTEMPT_LIFETIME_MS = 15 * 60 * 1000;

/** How long after its expiry an attempt is still shown as expired. */
const EXPIRED_VISIBILITY_MS = 60 * 60 * 1000;

const MAXIMUM_STATE_LENGTH = 200;

/** What happened to the callback of Discord, as the page that answers it tells. */
export type DiscordCallbackOutcome =
  | "authorized"
  | "denied"
  | "invalid"
  | "used"
  | "expired"
  | "failed"
  | "not_configured";

/** The query parameters of the callback; every one comes from an untrusted browser. */
export interface DiscordCallbackInput {
  readonly state: string | null;
  readonly code: string | null;
  readonly guildId: string | null;
  readonly error: string | null;
}

/** The part of the Discord client the authorization needs. */
export type DiscordAuthorizationClient = Pick<
  DiscordApiClient,
  "exchangeAuthorizationCode" | "getGuild"
>;

/** The Discord application and a client that speaks for it. */
export interface DiscordRuntime {
  readonly application: Pick<DiscordApplication, "applicationId">;
  readonly client: DiscordAuthorizationClient;
}

/** Collaborators of the authorization service. */
export interface DiscordAuthorizationDependencies {
  readonly attempts: DiscordAttemptStore;
  /** `null` while the instance has no Discord application. */
  readonly runtime: DiscordRuntime | null;
  readonly now?: () => Date;
}

/** Hashes an OAuth state, so a leaked database cannot complete an attempt. */
export function hashDiscordState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function isClientFailure(failure: DiscordFailure): boolean {
  return failure.problem === "invalid_credentials";
}

/**
 * Binds the Discord installation flow to a Pages user and project.
 *
 * @remarks
 * Starting an attempt stores only the hash of a random OAuth `state`, the user
 * and the project. The callback may arrive from another device, for example the
 * phone that scanned the QR code, so it needs no Pages session: the `state` is
 * the proof, valid once and for a short time. The callback only records the
 * server Pages verified itself; nothing is connected until the person who
 * started the attempt confirms server and channel in Pages.
 */
export class DiscordAuthorizationService {
  private readonly attempts: DiscordAttemptStore;
  private readonly runtime: DiscordRuntime | null;
  private readonly now: () => Date;

  /**
   * Creates the authorization service.
   *
   * @param dependencies - Attempt storage, Discord access and the clock.
   */
  public constructor(dependencies: DiscordAuthorizationDependencies) {
    this.attempts = dependencies.attempts;
    this.runtime = dependencies.runtime;
    this.now = dependencies.now ?? (() => new Date());
  }

  /**
   * Starts an attempt and builds the official Discord install link.
   *
   * @param input - The signed-in user, the project and the public address.
   * @returns The attempt with the link; the link is only available here.
   * @throws {DiscordError} `not_configured` without a Discord application.
   */
  public async start(input: {
    readonly userId: string;
    readonly projectId: string;
    readonly baseUrl: string;
  }): Promise<DiscordAttempt> {
    const runtime = this.requireRuntime();
    const state = randomBytes(32).toString("base64url");
    const created = this.now();
    const record = {
      baseUrl: input.baseUrl,
      createdAt: created.toISOString(),
      expiresAt: new Date(
        created.getTime() + ATTEMPT_LIFETIME_MS,
      ).toISOString(),
      id: randomUUID(),
      projectId: input.projectId,
      stateHash: hashDiscordState(state),
      userId: input.userId,
    };

    await this.attempts.insertAttempt(record);

    return {
      authorizeUrl: buildAuthorizationUrl({
        applicationId: runtime.application.applicationId,
        redirectUri: `${input.baseUrl}${DISCORD_CALLBACK_PATH}`,
        state,
      }),
      expiresAt: record.expiresAt,
      failure: null,
      guild: null,
      id: record.id,
      status: "pending",
    };
  }

  /**
   * Handles the callback of Discord for whoever opened it.
   *
   * @param input - The query parameters of the callback.
   * @returns What the callback page tells the person; the details stay in the
   * attempt that the desktop view reads.
   */
  public async complete(
    input: DiscordCallbackInput,
  ): Promise<DiscordCallbackOutcome> {
    const runtime = this.runtime;

    if (!runtime) {
      return "not_configured";
    }

    const state = input.state;

    if (!state || state.length > MAXIMUM_STATE_LENGTH) {
      return "invalid";
    }

    const stateHash = hashDiscordState(state);
    const attempt = await this.attempts.claimByStateHash(
      stateHash,
      this.now().toISOString(),
    );

    if (!attempt) {
      return this.explainRefusedState(stateHash);
    }

    if (input.error !== null) {
      await this.attempts.recordFailure(attempt.id, "denied");

      return "denied";
    }

    return this.verify(runtime, attempt, input);
  }

  /**
   * Returns the attempt a user started for a project, as that user sees it.
   *
   * @param userId - The signed-in user.
   * @param projectId - The project of the panel.
   * @returns The newest attempt that is still of interest, or `null`.
   */
  public async findOwn(
    userId: string,
    projectId: string,
  ): Promise<DiscordAttempt | null> {
    const record = await this.attempts.findLatestAttempt(projectId, userId);

    return record ? this.toView(record) : null;
  }

  /**
   * Returns an authorized attempt that the user may still confirm.
   *
   * @param input - The attempt, the signed-in user and the project.
   * @returns The attempt, now bound to server and user.
   * @throws {DiscordError} `attempt_invalid` for an attempt of someone else or
   * another project, one that is not authorized, or one that expired.
   */
  public async requireConfirmable(input: {
    readonly attemptId: string;
    readonly userId: string;
    readonly projectId: string;
  }): Promise<DiscordAttemptRecord & { guildId: string; guildName: string }> {
    const record = await this.attempts.findAttempt(input.attemptId);

    if (
      !record ||
      record.userId !== input.userId ||
      record.projectId !== input.projectId ||
      record.status !== "authorized" ||
      record.guildId === null ||
      record.guildName === null ||
      this.isExpired(record)
    ) {
      throw new DiscordError("attempt_invalid");
    }

    return { ...record, guildId: record.guildId, guildName: record.guildName };
  }

  /**
   * Uses up an authorized attempt, once.
   *
   * @param attemptId - The attempt that was confirmed.
   * @throws {DiscordError} `attempt_invalid` when another request used it first.
   */
  public async consume(attemptId: string): Promise<void> {
    const isConsumed = await this.attempts.confirm(
      attemptId,
      this.now().toISOString(),
    );

    if (!isConsumed) {
      throw new DiscordError("attempt_invalid");
    }
  }

  /** Ends an attempt the person abandoned. */
  public async cancel(input: {
    readonly attemptId: string;
    readonly userId: string;
    readonly projectId: string;
  }): Promise<void> {
    const record = await this.attempts.findAttempt(input.attemptId);

    if (
      record?.userId === input.userId &&
      record.projectId === input.projectId
    ) {
      await this.attempts.cancel(record.id);
    }
  }

  private requireRuntime(): DiscordRuntime {
    if (!this.runtime) {
      throw new DiscordError("not_configured");
    }

    return this.runtime;
  }

  private isExpired(record: DiscordAttemptRecord): boolean {
    return record.expiresAt <= this.now().toISOString();
  }

  private async explainRefusedState(
    stateHash: string,
  ): Promise<DiscordCallbackOutcome> {
    const known = await this.attempts.findAttemptByStateHash(stateHash);

    if (!known) {
      return "invalid";
    }

    if (known.consumedAt !== null) {
      return "used";
    }

    return this.isExpired(known) ? "expired" : "invalid";
  }

  private async verify(
    runtime: DiscordRuntime,
    attempt: DiscordAttemptRecord,
    input: DiscordCallbackInput,
  ): Promise<DiscordCallbackOutcome> {
    if (!input.code) {
      return this.fail(attempt, "exchange_failed");
    }

    const exchange = await runtime.client.exchangeAuthorizationCode(
      input.code,
      `${attempt.baseUrl}${DISCORD_CALLBACK_PATH}`,
    );

    if (!exchange.ok) {
      this.reportFailure(exchange.failure);

      return this.fail(attempt, "exchange_failed");
    }

    // Only the token response proves which server the person chose; the
    // `guild_id` of the address is a claim of the browser and may only agree.
    const guildId = exchange.value.guildId;

    if (guildId === null) {
      return this.fail(attempt, "no_guild");
    }

    if (input.guildId !== null && input.guildId !== guildId) {
      return this.fail(attempt, "verification_failed");
    }

    return this.verifyGuild(runtime, attempt, guildId);
  }

  private async verifyGuild(
    runtime: DiscordRuntime,
    attempt: DiscordAttemptRecord,
    guildId: string,
  ): Promise<DiscordCallbackOutcome> {
    // The bot token proves the bot really is a member of the server.
    const guild = await runtime.client.getGuild(guildId);

    if (!guild.ok) {
      this.reportFailure(guild.failure);

      return this.fail(attempt, "verification_failed");
    }

    if (guild.value.id !== guildId) {
      return this.fail(attempt, "verification_failed");
    }

    const isStored = await this.attempts.recordAuthorization(attempt.id, {
      id: guild.value.id,
      name: guild.value.name,
    });

    // Cancelled or replaced while Discord was asked: nothing may revive it.
    return isStored ? "authorized" : "invalid";
  }

  private async fail(
    attempt: DiscordAttemptRecord,
    failure: DiscordAttemptFailure,
  ): Promise<DiscordCallbackOutcome> {
    const isStored = await this.attempts.recordFailure(attempt.id, failure);

    return isStored ? "failed" : "invalid";
  }

  private reportFailure(failure: DiscordFailure): void {
    if (isClientFailure(failure)) {
      console.error(
        "Pages could not authorize with Discord: the application credentials are invalid.",
      );
    }
  }

  private toView(record: DiscordAttemptRecord): DiscordAttempt | null {
    const visibleUntil =
      new Date(record.expiresAt).getTime() + EXPIRED_VISIBILITY_MS;

    if (
      record.status === "confirmed" ||
      record.status === "cancelled" ||
      this.now().getTime() > visibleUntil
    ) {
      return null;
    }

    const isOpen =
      record.status === "pending" || record.status === "authorized";

    return {
      authorizeUrl: null,
      expiresAt: record.expiresAt,
      failure: record.failure,
      guild:
        record.guildId !== null && record.guildName !== null
          ? { id: record.guildId, name: record.guildName }
          : null,
      id: record.id,
      status: isOpen && this.isExpired(record) ? "expired" : record.status,
    };
  }
}
