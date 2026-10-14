import { DiscordAttemptRepository } from "@/backend/database/repositories/discord/DiscordAttemptRepository";
import { DiscordConnectionRepository } from "@/backend/database/repositories/discord/DiscordConnectionRepository";
import { DiscordDeliveryRepository } from "@/backend/database/repositories/discord/DiscordDeliveryRepository";
import { DiscordApiClient } from "@/backend/discord/DiscordApiClient";
import {
  describeDiscordInstance,
  readDiscordApplication,
} from "@/backend/discord/DiscordConfig";
import { DiscordAuthorizationService } from "@/backend/service/discord/DiscordAuthorizationService";
import { DiscordChannelCatalog } from "@/backend/service/discord/DiscordChannelCatalog";
import { DiscordConnectionService } from "@/backend/service/discord/DiscordConnectionService";
import { DiscordDeliveryScheduler } from "@/backend/service/discord/DiscordDeliveryScheduler";
import { DiscordDeliveryWorker } from "@/backend/service/discord/DiscordDeliveryWorker";
import { DiscordNotificationService } from "@/backend/service/discord/DiscordNotificationService";
import { DiscordSubjectLookup } from "@/backend/service/discord/DiscordSubjectLookup";

import type { Database } from "@/backend/database/Database";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import type { ProjectService } from "@/backend/service/ProjectService";

declare global {
  var pagesDiscordSchedulerStarted: boolean | undefined;
}

/** The Discord notifications of projects: connecting, settings and delivery. */
export interface DiscordApplicationServices {
  readonly discordAuthorizationService: DiscordAuthorizationService;
  readonly discordConnectionService: DiscordConnectionService;
}

/** What the Discord services are built from. */
export interface DiscordServiceContext {
  readonly database: Database;
  readonly projectService: ProjectService;
  readonly projectRepository: ProjectRepository;
  readonly taskRepository: TaskRepository;
  /** The publisher that interface changes and agent changes announce themselves on. */
  readonly events: PagesEventPublisher;
}

/**
 * Wires the Discord notifications on the shared database.
 *
 * @param context - Repositories, project access and the event publisher.
 * @returns The services of the interface. Without the Discord application of
 * the instance they only explain what is missing: nothing listens to events
 * and nothing is delivered.
 *
 * @remarks
 * The application (id, client secret, bot token) comes from the environment
 * and never leaves this process. The delivery scheduler runs once per process,
 * like the GitHub synchronization.
 */
export function createDiscordServices(
  context: DiscordServiceContext,
): DiscordApplicationServices {
  const application = readDiscordApplication();
  const client = application ? new DiscordApiClient(application) : null;
  const connections = new DiscordConnectionRepository(context.database);
  const attempts = new DiscordAttemptRepository(context.database);
  const deliveries = new DiscordDeliveryRepository(context.database);
  const authorization = new DiscordAuthorizationService({
    attempts,
    runtime: application && client ? { application, client } : null,
  });

  if (client) {
    startDelivery({ attempts, client, connections, context, deliveries });
  }

  return {
    discordAuthorizationService: authorization,
    discordConnectionService: new DiscordConnectionService({
      activity: context.projectRepository,
      authorization,
      catalog:
        application && client
          ? new DiscordChannelCatalog(client, application.applicationId)
          : null,
      connections,
      deliveries,
      instance: describeDiscordInstance(),
      projects: context.projectService,
      sender: client,
    }),
  };
}

/** Subscribes to the events and starts the delivery of what they store. */
function startDelivery(input: {
  readonly attempts: DiscordAttemptRepository;
  readonly client: DiscordApiClient;
  readonly connections: DiscordConnectionRepository;
  readonly context: DiscordServiceContext;
  readonly deliveries: DiscordDeliveryRepository;
}): void {
  const { attempts, client, connections, context, deliveries } = input;
  const scheduler = new DiscordDeliveryScheduler(
    new DiscordDeliveryWorker({
      attempts,
      connections,
      deliveries,
      sender: client,
    }),
  );

  new DiscordNotificationService({
    connections,
    deliveries,
    onEnqueued: () => scheduler.kick(),
    subjects: new DiscordSubjectLookup(
      context.taskRepository,
      context.projectRepository,
    ),
  }).listen(context.events);

  if (globalThis.pagesDiscordSchedulerStarted) {
    return;
  }

  globalThis.pagesDiscordSchedulerStarted = true;
  scheduler.start();
}
