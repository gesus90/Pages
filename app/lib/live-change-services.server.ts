import { isLocalSessionOwner } from "@/backend/agents/local/LocalSessionMode";
import { PostgresNotificationListener } from "@/backend/database/postgres/PostgresNotificationListener";
import {
  LIVE_CHANGE_CHANNEL,
  LiveChangeNotificationRepository,
} from "@/backend/database/repositories/LiveChangeNotificationRepository";
import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
import { isPagesRunsProcess } from "@/backend/runtime/RunsMode";
import { LiveChangeAudience } from "@/backend/service/events/LiveChangeAudience";
import { LiveChangeHub } from "@/backend/service/events/LiveChangeHub";
import {
  forwardLiveChanges,
  readRelayedEvent,
} from "@/backend/service/events/LiveChangeRelay";

import { conversationMembership } from "./conversation-services.server";

import type { Database } from "@/backend/database/Database";
import type { LiveChangeAudienceDependencies } from "@/backend/service/events/LiveChangeAudience";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";

/** What the live view of a process is built from. */
export interface LiveChangeContext {
  readonly database: Database;
  /** The instance's PostgreSQL URL; without it no other process can be heard. */
  readonly databaseUrl: string | undefined;
  readonly events: PagesEventPublisher;
  /** The rights-checked reads; the membership of conversations comes from the database. */
  readonly audience: Omit<LiveChangeAudienceDependencies, "conversations">;
}

/** The live view of a process and the audience check it shares with `pages-core`. */
export interface LiveChangeServices {
  readonly liveChangeHub: LiveChangeHub;
  /** Answers the decisions `pages-core` asks for (PAGE-237). */
  readonly liveChangeAudience: LiveChangeAudience;
}

/**
 * Creates the live view of this process and joins it to the other processes.
 *
 * @remarks
 * Only the API process serves `/live-changes`. It hears its own publisher
 * directly and the plan engine, the local session owner and the integration
 * delivery through PostgreSQL `NOTIFY`, which those processes send for every
 * committed event. Whenever the listening session starts listening, the first
 * time included, every open stream reads everything again, because PostgreSQL
 * keeps no notifications from before. The server stop ends the session.
 *
 * @param context - Database, publisher and the rights-checked reads.
 * @returns The hub and its audience check; in a process without the live
 * view nobody opens a stream on the hub.
 */
export function createLiveChangeServices(
  context: LiveChangeContext,
): LiveChangeServices {
  const audience = new LiveChangeAudience({
    ...context.audience,
    conversations: conversationMembership(context.database),
  });
  const hub = new LiveChangeHub(context.events, audience);
  const services = { liveChangeHub: hub, liveChangeAudience: audience };
  if (isPagesRunsProcess() || isLocalSessionOwner()) {
    forwardLiveChanges(
      context.events,
      new LiveChangeNotificationRepository(context.database),
    );
    return services;
  }
  if (context.databaseUrl) {
    const listener = new PostgresNotificationListener(
      context.databaseUrl,
      LIVE_CHANGE_CHANNEL,
      {
        onMessage: (payload) => {
          const event = readRelayedEvent(payload);
          if (event) hub.receive(event);
        },
        onListening: () => hub.resyncAll(),
      },
    );
    registerShutdownTask(() => listener.stop(), {
      step: "live_changes_listener",
    });
    listener.start();
  }
  return services;
}
