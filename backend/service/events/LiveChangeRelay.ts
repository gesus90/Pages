import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { logCaughtError } from "@/backend/logging/Logger";

import type { LiveChangeNotificationRepository } from "@/backend/database/repositories/LiveChangeNotificationRepository";
import type {
  PagesEvent,
  PagesEventAudience,
} from "@/backend/service/events/PagesEventPublisher";

/** Every type a relayed event may have; anything else on the channel is dropped. */
const RELAYED_TYPES: ReadonlySet<string> = new Set<PagesEvent["type"]>([
  "wiki.page.created",
  "wiki.page.updated",
  "wiki.comments.changed",
  "wiki.page.purged",
  "ticket.created",
  "ticket.updated",
  "ticket.changed",
  "ticket.deleted",
  "milestone.created",
  "milestone.updated",
  "milestone.changed",
  "project.tickets.changed",
  "project.access.changed",
  "conversation.changed",
]);

function isEventType(value: unknown): value is PagesEvent["type"] {
  return typeof value === "string" && RELAYED_TYPES.has(value);
}

function readAudience(value: unknown): PagesEventAudience | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("projectId" in value) || !("departmentId" in value)) return undefined;
  const { projectId, departmentId } = value;
  if (typeof projectId !== "string") return undefined;
  if (departmentId !== null && typeof departmentId !== "string")
    return undefined;
  return { projectId, departmentId };
}

/**
 * Reads one relayed event; a payload of any other shape is no event.
 *
 * @param payload - The `NOTIFY` payload of another process.
 * @returns The event, or `null`.
 */
export function readRelayedEvent(payload: string): PagesEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  if (!("type" in value) || !("id" in value)) return null;
  if (!isEventType(value.type) || typeof value.id !== "string") return null;
  const audience =
    "audience" in value ? readAudience(value.audience) : undefined;
  return audience
    ? { type: value.type, id: value.id, audience }
    : { type: value.type, id: value.id };
}

/**
 * Hands the committed events of a process without the live view to the API process.
 *
 * @remarks
 * The plan engine and the integration delivery may run as processes of their
 * own. Their events travel as `NOTIFY` with type, id and, for a deleted
 * ticket, its audience; the API process decides delivery with the receiving
 * account's rights as for its own events. A lost notification only delays a
 * page until its next reading.
 *
 * @param source - The publisher of this process.
 * @param repository - Sends the notification.
 * @returns Stops forwarding.
 */
export function forwardLiveChanges(
  source: { subscribe(listener: (event: PagesEvent) => void): () => void },
  repository: LiveChangeNotificationRepository,
): () => void {
  return source.subscribe((event) => {
    if (!isEventType(event.type)) return;
    const payload = JSON.stringify(event);
    void withBackgroundDatabaseWork("live_change_relay", () =>
      repository.notify(payload),
    ).catch((caughtError: unknown) => {
      logCaughtError("LiveChangeRelay", caughtError);
    });
  });
}
