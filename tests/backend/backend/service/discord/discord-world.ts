import { DiscordApiClient } from "@/backend/discord/DiscordApiClient";
import {
  ProjectAccessDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import { DiscordAuthorizationService } from "@/backend/service/discord/DiscordAuthorizationService";
import { DiscordChannelCatalog } from "@/backend/service/discord/DiscordChannelCatalog";
import { DiscordConnectionService } from "@/backend/service/discord/DiscordConnectionService";
import { DiscordDeliveryWorker } from "@/backend/service/discord/DiscordDeliveryWorker";
import { DiscordNotificationService } from "@/backend/service/discord/DiscordNotificationService";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import { ROLE } from "@/definition/Role";

import {
  MemoryAttemptStore,
  MemoryConnectionStore,
  MemoryDeliveryStore,
} from "./discord-memory-stores";
import { APPLICATION, FakeDiscord } from "./fake-discord";

import type { NewProjectActivity } from "@/backend/database/repositories/ProjectRepository";
import type {
  DiscordMilestoneFacts,
  DiscordSubjectReader,
  DiscordTicketFacts,
} from "@/backend/service/discord/DiscordNotificationService";
import type { DiscordInterfaceState } from "@/definition/Discord";
import type { User } from "@/definition/User";

/** Where the synthetic Pages instance claims to be reachable. */
export const BASE_URL = "https://pages.example.test";

/** A synthetic project and who may do what in it. */
export interface WorldProject {
  readonly name: string;
  readonly writers: Set<string>;
  readonly readers: Set<string>;
}

/** Builds a user of the synthetic instance. */
export function person(id: string): User {
  return {
    displayName: id,
    id,
    isActive: true,
    mustChangePassword: false,
    role: ROLE.MANAGER,
    username: id,
  };
}

/** The ticket facts of a synthetic public ticket. */
export function ticketFacts(
  overrides: Partial<DiscordTicketFacts> = {},
): DiscordTicketFacts {
  return {
    departmentId: null,
    key: "PAGE-7",
    projectId: "alpha",
    projectName: "Alpha",
    statusName: "In Arbeit",
    title: "Write the notification",
    ...overrides,
  };
}

/**
 * The real Discord services around in-memory storage and a synthetic Discord.
 *
 * @remarks
 * Only the outside is replaced: the database by in-memory stores that follow
 * the rules of the SQL, Discord by {@link FakeDiscord}, project rights by a
 * table. The OAuth state, the permission computation, the delivery rules and
 * the message building are the production code.
 */
export class DiscordWorld {
  public readonly discord = new FakeDiscord();
  public readonly attempts = new MemoryAttemptStore();
  public readonly deliveries = new MemoryDeliveryStore();
  public readonly connections = new MemoryConnectionStore(this.deliveries);
  public readonly publisher = new PagesEventPublisher();
  public readonly projects = new Map<string, WorldProject>();
  public readonly activity: NewProjectActivity[] = [];
  public readonly tickets = new Map<string, DiscordTicketFacts>();
  public readonly milestones = new Map<string, DiscordMilestoneFacts>();
  public readonly owner = person("owner");
  public readonly reader = person("reader");
  public readonly stranger = person("stranger");
  public readonly authorization: DiscordAuthorizationService;
  public readonly service: DiscordConnectionService;
  public readonly notifications: DiscordNotificationService;
  public readonly worker: DiscordDeliveryWorker;
  public enqueued = 0;
  private time = Date.parse("2026-10-15T10:00:00.000Z");

  public constructor() {
    const client = new DiscordApiClient(APPLICATION, this.discord.fetch);
    const now = (): Date => new Date(this.time);

    this.projects.set("alpha", {
      name: "Alpha",
      readers: new Set(["owner", "reader"]),
      writers: new Set(["owner"]),
    });
    this.projects.set("beta", {
      name: "Beta",
      readers: new Set(["owner"]),
      writers: new Set(["owner"]),
    });
    this.authorization = new DiscordAuthorizationService({
      attempts: this.attempts,
      now,
      runtime: { application: APPLICATION, client },
    });
    this.service = new DiscordConnectionService({
      activity: {
        insertActivity: async (entry) => {
          this.activity.push(entry);
        },
      },
      authorization: this.authorization,
      catalog: new DiscordChannelCatalog(client, APPLICATION.applicationId),
      connections: this.connections,
      deliveries: this.deliveries,
      instance: { isConfigured: true, missingSettings: [] },
      now,
      projects: {
        canWriteProject: async (actor, projectId) =>
          this.projects.get(projectId)?.writers.has(actor.id) ?? false,
        getById: async (actor, projectId) => this.readProject(actor, projectId),
      },
      resolveBaseUrl: () => BASE_URL,
      sender: client,
    });
    this.notifications = new DiscordNotificationService({
      connections: this.connections,
      deliveries: this.deliveries,
      now,
      onEnqueued: () => {
        this.enqueued += 1;
      },
      subjects: this.createSubjects(),
    });
    this.worker = new DiscordDeliveryWorker({
      attempts: this.attempts,
      connections: this.connections,
      deliveries: this.deliveries,
      now,
      sender: client,
    });
  }

  /** Moves the clock forward. */
  public advance(milliseconds: number): void {
    this.time += milliseconds;
  }

  /** The current time of the world as an ISO string. */
  public now(): string {
    return new Date(this.time).toISOString();
  }

  /** Extracts the OAuth state out of the install link of a started attempt. */
  public stateOf(state: DiscordInterfaceState): string {
    const url = state.attempt?.authorizeUrl;

    if (!url) {
      throw new Error("The attempt has no install link.");
    }

    const value = new URL(url).searchParams.get("state");

    if (value === null) {
      throw new Error("The install link has no state.");
    }

    return value;
  }

  /**
   * Starts an attempt as the owner and lets Discord authorize a server.
   *
   * @returns The state of the panel and the callback query of the authorization.
   */
  public async startAndAuthorize(guildId = "300"): Promise<{
    readonly state: DiscordInterfaceState;
    readonly callback: {
      readonly state: string;
      readonly code: string;
      readonly guildId: string;
      readonly error: null;
    };
  }> {
    // A second attempt must be newer than the first by the clock, as in real use.
    this.advance(1_000);

    const state = await this.service.startConnection(this.owner, {
      projectId: "alpha",
      requestOrigin: BASE_URL,
    });
    const code = `code-${guildId}`;

    this.discord.grantCode(code, guildId);

    return {
      callback: { code, error: null, guildId, state: this.stateOf(state) },
      state,
    };
  }

  /** Connects the project "alpha" to a server and its first channel. */
  public async connectAlpha(channelId = "201"): Promise<DiscordInterfaceState> {
    if (!this.discord.guilds.has("300")) {
      this.discord.addGuild({ id: "300", name: "Team server" });
    }

    const { callback } = await this.startAndAuthorize("300");

    await this.authorization.complete(callback);

    const attempt = await this.attempts.findLatestAttempt("alpha", "owner");

    if (!attempt) {
      throw new Error("The attempt is missing.");
    }

    return this.service.confirmConnection(this.owner, "alpha", {
      attemptId: attempt.id,
      channelId,
    });
  }

  private readProject(
    actor: User,
    projectId: string,
  ): { readonly name: string } {
    const project = this.projects.get(projectId);

    if (!project) {
      throw new ProjectNotFoundError();
    }

    if (!project.readers.has(actor.id)) {
      throw new ProjectAccessDeniedError();
    }

    return { name: project.name };
  }

  private createSubjects(): DiscordSubjectReader {
    return {
      findMilestone: async (id) => this.milestones.get(id) ?? null,
      findTicket: async (id) => this.tickets.get(id) ?? null,
    };
  }
}
