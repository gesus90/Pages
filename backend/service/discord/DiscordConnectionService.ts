import { randomBytes, randomUUID } from "node:crypto";

import { buildTestMessage } from "@/backend/discord/DiscordMessage";
import { resolvePublicBaseUrl } from "@/backend/discord/DiscordConfig";
import { DiscordError } from "@/backend/error/DiscordErrors";
import { ProjectManagementDeniedError } from "@/backend/error/ProjectErrors";
import {
  DEFAULT_DISCORD_EVENTS,
  DISCORD_EVENT_TYPES,
} from "@/definition/Discord";

import type { DiscordApiClient } from "@/backend/discord/DiscordApiClient";
import type { DiscordConnectionStore } from "@/backend/database/repositories/discord/DiscordConnectionRepository";
import type { DiscordDeliveryStore } from "@/backend/database/repositories/discord/DiscordDeliveryRepository";
import type { StoredDiscordConnection } from "@/backend/database/repositories/discord/DiscordConnectionRepository";
import type { NewProjectActivity } from "@/backend/database/repositories/ProjectRepository";
import type { DiscordAuthorizationService } from "@/backend/service/discord/DiscordAuthorizationService";
import type { DiscordChannelCatalog } from "@/backend/service/discord/DiscordChannelCatalog";
import type {
  DiscordAttempt,
  DiscordChannelChoice,
  DiscordConnection,
  DiscordEventSelection,
  DiscordInstanceStatus,
  DiscordInterfaceState,
  DiscordProblem,
  DiscordTestResult,
} from "@/definition/Discord";
import type { User } from "@/definition/User";

const TEST_NONCE_LENGTH = 24;

/** What the Discord service asks of the project service. */
export interface DiscordProjectAccess {
  /** Resolves for a project the actor may read, and throws otherwise. */
  getById(actor: User, projectId: string): Promise<{ readonly name: string }>;
  canWriteProject(actor: User, projectId: string): Promise<boolean>;
}

/** Where the connection changes appear in the activity log of the project. */
export interface DiscordActivityLog {
  insertActivity(entry: NewProjectActivity): Promise<void>;
}

/** Collaborators of the connection service. */
export interface DiscordConnectionServiceDependencies {
  readonly projects: DiscordProjectAccess;
  readonly connections: DiscordConnectionStore;
  readonly deliveries: Pick<DiscordDeliveryStore, "summarize">;
  readonly authorization: DiscordAuthorizationService;
  readonly instance: DiscordInstanceStatus;
  /** `null` while the instance has no Discord application. */
  readonly catalog: Pick<DiscordChannelCatalog, "list"> | null;
  readonly sender: Pick<DiscordApiClient, "createMessage"> | null;
  readonly activity: DiscordActivityLog;
  readonly now?: () => Date;
  /** Resolves the public address of this instance; defaults to the configuration. */
  readonly resolveBaseUrl?: (requestOrigin: string) => string;
}

/** The server and channel a person confirms to complete a connection. */
export interface DiscordConfirmation {
  readonly attemptId: string;
  readonly channelId: string;
}

/**
 * Connects a project to a Discord server and channel and keeps its settings.
 *
 * @remarks
 * Every change needs the right to write in the project, the one the GitHub
 * interface already asks for; everyone who can read the project sees the
 * connection read-only. Nothing is stored before the person who started the
 * attempt confirmed a server Pages verified and a channel in which the bot
 * can see and post.
 */
export class DiscordConnectionService {
  private readonly dependencies: DiscordConnectionServiceDependencies;
  private readonly now: () => Date;

  /**
   * Creates the connection service.
   *
   * @param dependencies - Project access, storage and Discord access.
   */
  public constructor(dependencies: DiscordConnectionServiceDependencies) {
    this.dependencies = dependencies;
    this.now = dependencies.now ?? (() => new Date());
  }

  /**
   * Returns everything the Discord panel of a project shows.
   *
   * @param actor - The signed-in user; any user who can read the project.
   * @param projectId - The project of the panel.
   * @param options - Whether to list the channels of the connected server.
   * @returns The connection, the actor's own attempt and the channel choices.
   */
  public async getState(
    actor: User,
    projectId: string,
    options: { readonly includeChannels?: boolean } = {},
  ): Promise<DiscordInterfaceState> {
    const { projects, connections, deliveries, authorization } =
      this.dependencies;

    await projects.getById(actor, projectId);

    const canManage = await projects.canWriteProject(actor, projectId);
    const stored = await connections.findConnection(projectId);
    const connection = stored
      ? this.toConnection(stored, await deliveries.summarize(projectId))
      : null;
    const attempt = canManage
      ? await authorization.findOwn(actor.id, projectId)
      : null;
    const guildId = canManage
      ? this.findGuildToList(attempt, stored, options.includeChannels === true)
      : null;
    const channels = guildId ? await this.listChannels(guildId) : null;

    return {
      attempt,
      canManage,
      channels: channels?.choices ?? null,
      channelsProblem: channels?.problem ?? null,
      connection,
      instance: this.dependencies.instance,
    };
  }

  /**
   * Tells whether the project has a Discord connection.
   *
   * @param actor - The signed-in user; any user who can read the project.
   * @param projectId - The project of the card.
   * @returns Whether notifications are connected.
   */
  public async isConnected(actor: User, projectId: string): Promise<boolean> {
    await this.dependencies.projects.getById(actor, projectId);

    return (
      (await this.dependencies.connections.findConnection(projectId)) !== null
    );
  }

  /**
   * Starts the installation of the bot and returns the link for the QR code.
   *
   * @param actor - The signed-in user who may write in the project.
   * @param input - The project and the origin of the request.
   * @returns The panel state with the new attempt and its official link.
   * @throws {DiscordError} `not_configured` without a Discord application.
   */
  public async startConnection(
    actor: User,
    input: { readonly projectId: string; readonly requestOrigin: string },
  ): Promise<DiscordInterfaceState> {
    await this.requireManage(actor, input.projectId);

    if (!this.dependencies.instance.isConfigured) {
      throw new DiscordError("not_configured");
    }

    const resolveBaseUrl =
      this.dependencies.resolveBaseUrl ??
      ((origin: string) => resolvePublicBaseUrl(origin));
    const attempt = await this.dependencies.authorization.start({
      baseUrl: resolveBaseUrl(input.requestOrigin),
      projectId: input.projectId,
      userId: actor.id,
    });

    return { ...(await this.getState(actor, input.projectId)), attempt };
  }

  /**
   * Saves the connection once server and channel are confirmed.
   *
   * @param actor - The signed-in user who started the attempt.
   * @param projectId - The project to connect.
   * @param confirmation - The attempt and the channel the person chose.
   * @returns The panel state with the new connection.
   * @throws {DiscordError} `attempt_invalid` for an unknown, foreign, expired
   * or used attempt and `channel_unavailable` when the bot cannot post there.
   */
  public async confirmConnection(
    actor: User,
    projectId: string,
    confirmation: DiscordConfirmation,
  ): Promise<DiscordInterfaceState> {
    await this.requireManage(actor, projectId);

    const { authorization, connections } = this.dependencies;
    const attempt = await authorization.requireConfirmable({
      attemptId: confirmation.attemptId,
      projectId,
      userId: actor.id,
    });
    const channel = await this.requireSelectableChannel(
      attempt.guildId,
      confirmation.channelId,
    );

    await authorization.consume(attempt.id);

    const existing = await connections.findConnection(projectId);

    await connections.saveConnection({
      baseUrl: attempt.baseUrl,
      channelId: channel.id,
      channelName: channel.name,
      connectedBy: actor.id,
      events: existing?.events ?? DEFAULT_DISCORD_EVENTS,
      guildId: attempt.guildId,
      guildName: attempt.guildName,
      now: this.now().toISOString(),
      projectId,
    });
    await this.recordActivity(actor, projectId, {
      action: "discord_connected",
      message: "Discord notifications were connected.",
    });

    return this.getState(actor, projectId);
  }

  /**
   * Points the connection at another channel of the same server.
   *
   * @param actor - The signed-in user who may write in the project.
   * @param projectId - The connected project.
   * @param channelId - The channel the bot can see and post in.
   * @returns The panel state.
   * @throws {DiscordError} `not_connected` or `channel_unavailable`.
   */
  public async changeChannel(
    actor: User,
    projectId: string,
    channelId: string,
  ): Promise<DiscordInterfaceState> {
    await this.requireManage(actor, projectId);

    const connection = await this.requireConnection(projectId);
    const channel = await this.requireSelectableChannel(
      connection.guildId,
      channelId,
    );

    await this.dependencies.connections.updateChannel(
      projectId,
      channel,
      this.now().toISOString(),
    );
    await this.recordActivity(actor, projectId, {
      action: "discord_channel_changed",
      message: "The Discord channel was changed.",
    });

    return this.getState(actor, projectId);
  }

  /**
   * Switches the events of the project on or off, each on its own.
   *
   * @param actor - The signed-in user who may write in the project.
   * @param projectId - The connected project.
   * @param events - The complete selection of the four event types.
   * @returns The panel state.
   * @throws {DiscordError} `not_connected`, or `invalid_events` for a
   * selection that does not name every event with a boolean.
   */
  public async setEvents(
    actor: User,
    projectId: string,
    events: DiscordEventSelection,
  ): Promise<DiscordInterfaceState> {
    await this.requireManage(actor, projectId);
    await this.requireConnection(projectId);

    if (DISCORD_EVENT_TYPES.some((type) => typeof events[type] !== "boolean")) {
      throw new DiscordError("invalid_events");
    }

    await this.dependencies.connections.updateEvents(
      projectId,
      events,
      this.now().toISOString(),
    );
    await this.recordActivity(actor, projectId, {
      action: "discord_events_changed",
      message: "The Discord notification events were changed.",
    });

    return this.getState(actor, projectId);
  }

  /**
   * Sends a test message to the connected channel right away.
   *
   * @param actor - The signed-in user who may write in the project.
   * @param projectId - The connected project.
   * @returns Whether Discord accepted the message and, if not, the problem.
   * @throws {DiscordError} `not_connected` or `not_configured`.
   */
  public async sendTest(
    actor: User,
    projectId: string,
  ): Promise<DiscordTestResult> {
    await this.requireManage(actor, projectId);

    const { sender, projects } = this.dependencies;
    const connection = await this.requireConnection(projectId);

    if (!sender) {
      throw new DiscordError("not_configured");
    }

    const project = await projects.getById(actor, projectId);
    const result = await sender.createMessage(
      connection.channelId,
      buildTestMessage(
        project.name,
        `${connection.baseUrl}/projekte/${encodeURIComponent(projectId)}`,
      ),
      randomBytes(TEST_NONCE_LENGTH)
        .toString("base64url")
        .slice(0, TEST_NONCE_LENGTH),
    );

    return result.ok
      ? { isSent: true, problem: null }
      : { isSent: false, problem: result.failure.problem };
  }

  /**
   * Removes the Discord settings of the project.
   *
   * @param actor - The signed-in user who may write in the project.
   * @param projectId - The project to disconnect.
   * @returns The panel state without a connection.
   *
   * @remarks
   * Server, channel, event selection and the messages not yet sent go. The bot
   * stays on the Discord server; removing it is a separate act in Discord, and
   * other projects keep their own connection.
   */
  public async disconnect(
    actor: User,
    projectId: string,
  ): Promise<DiscordInterfaceState> {
    await this.requireManage(actor, projectId);

    const existed =
      await this.dependencies.connections.deleteConnection(projectId);

    if (existed) {
      await this.recordActivity(actor, projectId, {
        action: "discord_disconnected",
        message: "The Discord connection was removed.",
      });
    }

    return this.getState(actor, projectId);
  }

  /**
   * Abandons the attempt of the actor.
   *
   * @param actor - The signed-in user who may write in the project.
   * @param projectId - The project of the panel.
   * @param attemptId - The attempt to end.
   * @returns The panel state.
   */
  public async cancelAttempt(
    actor: User,
    projectId: string,
    attemptId: string,
  ): Promise<DiscordInterfaceState> {
    await this.requireManage(actor, projectId);
    await this.dependencies.authorization.cancel({
      attemptId,
      projectId,
      userId: actor.id,
    });

    return this.getState(actor, projectId);
  }

  private async requireManage(actor: User, projectId: string): Promise<void> {
    const { projects } = this.dependencies;

    await projects.getById(actor, projectId);

    if (!(await projects.canWriteProject(actor, projectId))) {
      throw new ProjectManagementDeniedError();
    }
  }

  private async requireConnection(
    projectId: string,
  ): Promise<StoredDiscordConnection> {
    const connection =
      await this.dependencies.connections.findConnection(projectId);

    if (!connection) {
      throw new DiscordError("not_connected");
    }

    return connection;
  }

  private async requireSelectableChannel(
    guildId: string,
    channelId: string,
  ): Promise<DiscordChannelChoice> {
    const catalog = this.dependencies.catalog;

    if (!catalog) {
      throw new DiscordError("not_configured");
    }

    const channels = await catalog.list(guildId);

    if (!channels.ok) {
      throw new DiscordError("discord_unavailable");
    }

    const channel = channels.value.find(
      (candidate) => candidate.id === channelId,
    );

    if (!channel?.isSelectable) {
      throw new DiscordError("channel_unavailable");
    }

    return channel;
  }

  private findGuildToList(
    attempt: DiscordAttempt | null,
    connection: StoredDiscordConnection | null,
    includeConnectedGuild: boolean,
  ): string | null {
    if (attempt?.status === "authorized" && attempt.guild) {
      return attempt.guild.id;
    }

    return includeConnectedGuild && connection ? connection.guildId : null;
  }

  private async listChannels(guildId: string): Promise<{
    readonly choices: readonly DiscordChannelChoice[] | null;
    readonly problem: DiscordProblem | null;
  }> {
    const catalog = this.dependencies.catalog;

    if (!catalog) {
      return { choices: null, problem: null };
    }

    const channels = await catalog.list(guildId);

    return channels.ok
      ? { choices: channels.value, problem: null }
      : { choices: null, problem: channels.failure.problem };
  }

  private toConnection(
    stored: StoredDiscordConnection,
    delivery: DiscordConnection["delivery"],
  ): DiscordConnection {
    return {
      channelId: stored.channelId,
      channelName: stored.channelName,
      connectedAt: stored.connectedAt,
      delivery,
      events: stored.events,
      guildId: stored.guildId,
      guildName: stored.guildName,
      projectId: stored.projectId,
      updatedAt: stored.updatedAt,
    };
  }

  private async recordActivity(
    actor: User,
    projectId: string,
    entry: { readonly action: string; readonly message: string },
  ): Promise<void> {
    await this.dependencies.activity.insertActivity({
      ...entry,
      category: "integrations",
      id: randomUUID(),
      projectId,
      userId: actor.id,
    });
  }
}
