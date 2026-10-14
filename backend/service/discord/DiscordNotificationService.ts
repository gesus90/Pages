import { randomUUID } from "node:crypto";

import { isDiscordEventType } from "@/definition/Discord";

import type { DiscordConnectionStore } from "@/backend/database/repositories/discord/DiscordConnectionRepository";
import type { DiscordDeliveryStore } from "@/backend/database/repositories/discord/DiscordDeliveryRepository";
import type { DiscordNotificationContent } from "@/backend/discord/DiscordMessage";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { DiscordEventType } from "@/definition/Discord";

/** The facts of a ticket that a notification states. */
export interface DiscordTicketFacts {
  readonly projectId: string;
  readonly projectName: string;
  readonly key: string;
  readonly title: string;
  readonly statusName: string;
  /** A ticket of a department is not visible to the whole project. */
  readonly departmentId: string | null;
}

/** The facts of a milestone that a notification states. */
export interface DiscordMilestoneFacts {
  readonly projectId: string;
  readonly projectName: string;
  readonly name: string;
  readonly status: string;
}

/** Reads the facts of the item an event is about, without any user context. */
export interface DiscordSubjectReader {
  findTicket(id: string): Promise<DiscordTicketFacts | null>;
  findMilestone(id: string): Promise<DiscordMilestoneFacts | null>;
}

/** Where committed Pages events come from. */
export interface DiscordEventSource {
  subscribe(listener: (event: PagesEvent) => void): () => void;
}

/** Collaborators of the notification service. */
export interface DiscordNotificationDependencies {
  readonly connections: Pick<DiscordConnectionStore, "findConnection">;
  readonly deliveries: Pick<DiscordDeliveryStore, "enqueueDelivery">;
  readonly subjects: DiscordSubjectReader;
  /** Called after a message was stored, so the delivery starts without waiting. */
  readonly onEnqueued?: () => void;
  readonly now?: () => Date;
}

interface Announcement {
  readonly projectId: string;
  readonly content: Omit<DiscordNotificationContent, "url">;
  readonly path: string;
}

/**
 * Turns committed ticket and milestone events into stored Discord messages.
 *
 * @remarks
 * The events arrive after the Pages transaction committed, from the interface
 * and from agents alike, so a rolled back change never reaches this service.
 * Nothing here calls Discord: a message is written to the outbox and delivered
 * later, which keeps the Pages write independent of Discord's availability.
 * A message is written only when the project has a connection and has the
 * event switched on.
 */
export class DiscordNotificationService {
  private readonly dependencies: DiscordNotificationDependencies;
  private readonly now: () => Date;

  /**
   * Creates the notification service.
   *
   * @param dependencies - Connection and outbox storage and the item reader.
   */
  public constructor(dependencies: DiscordNotificationDependencies) {
    this.dependencies = dependencies;
    this.now = dependencies.now ?? (() => new Date());
  }

  /**
   * Starts to react to the events of a publisher.
   *
   * @param source - Publisher of committed Pages events.
   * @returns Stops the subscription.
   */
  public listen(source: DiscordEventSource): () => void {
    return source.subscribe((event) => {
      void this.handle(event);
    });
  }

  /**
   * Stores a message for an event when the project wants it; never throws.
   *
   * @param event - A committed Pages event.
   */
  public async handle(event: PagesEvent): Promise<void> {
    if (!isDiscordEventType(event.type)) {
      return;
    }

    try {
      await this.enqueue(event.type, event.id);
    } catch (error: unknown) {
      // A failed notification must never be seen as a failed Pages change.
      console.error("Pages could not store a Discord notification.", error);
    }
  }

  private async enqueue(type: DiscordEventType, id: string): Promise<void> {
    const announcement = await this.describe(type, id);

    if (!announcement) {
      return;
    }

    const connection = await this.dependencies.connections.findConnection(
      announcement.projectId,
    );

    if (!connection?.events[type]) {
      return;
    }

    const content: DiscordNotificationContent = {
      ...announcement.content,
      url: `${connection.baseUrl}${announcement.path}`,
    };

    await this.dependencies.deliveries.enqueueDelivery({
      contentJson: JSON.stringify(content),
      eventType: type,
      id: randomUUID(),
      now: this.now().toISOString(),
      projectId: announcement.projectId,
      subjectKey: announcement.path,
    });
    this.dependencies.onEnqueued?.();
  }

  private async describe(
    type: DiscordEventType,
    id: string,
  ): Promise<Announcement | null> {
    return type.startsWith("ticket.")
      ? this.describeTicket(type, id)
      : this.describeMilestone(type, id);
  }

  private async describeTicket(
    type: DiscordEventType,
    id: string,
  ): Promise<Announcement | null> {
    const ticket = await this.dependencies.subjects.findTicket(id);

    // Only tickets every member of the project may see belong in a channel.
    if (!ticket || ticket.departmentId !== null) {
      return null;
    }

    return {
      content: {
        event: type,
        projectName: ticket.projectName,
        reference: ticket.key,
        status: ticket.statusName,
        title: ticket.title,
      },
      path: `/tasks/${encodeURIComponent(ticket.key)}`,
      projectId: ticket.projectId,
    };
  }

  private async describeMilestone(
    type: DiscordEventType,
    id: string,
  ): Promise<Announcement | null> {
    const milestone = await this.dependencies.subjects.findMilestone(id);

    if (!milestone) {
      return null;
    }

    return {
      content: {
        event: type,
        projectName: milestone.projectName,
        reference: null,
        status: milestone.status,
        title: milestone.name,
      },
      path: `/projekte/${encodeURIComponent(milestone.projectId)}?tab=planning`,
      projectId: milestone.projectId,
    };
  }
}
