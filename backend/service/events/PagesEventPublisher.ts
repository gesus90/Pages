import {
  logCaughtError,
  logDiagnostic,
  logEvent,
} from "@/backend/logging/Logger";

/** Internal post-commit notification; content and user metadata never enter events. */
export interface PagesEvent {
  readonly type:
    | "wiki.page.created"
    | "wiki.page.updated"
    | "wiki.comments.changed"
    | "asset.linked"
    | "ticket.created"
    | "ticket.updated"
    | "milestone.created"
    | "milestone.updated";
  readonly id: string;
}

/** Delivers internal events without allowing a subscriber to undo a committed write. */
export class PagesEventPublisher {
  private readonly listeners = new Set<(event: PagesEvent) => void>();

  /** Registers one process-local subscriber and returns its release function. */
  public subscribe(listener: (event: PagesEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Emits only after the database transaction has committed. */
  public publish(event: PagesEvent): void {
    logEvent({
      level: "info",
      event: event.type,
      component: "PagesEventPublisher",
      message: "Business change committed",
      metadata: { eventType: event.type },
    });
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (caughtError: unknown) {
        logCaughtError("PagesEventPublisher", caughtError);

        logDiagnostic(
          "PagesEventPublisher",
          "warn",
          "Pages event subscriber failed.",
        );
      }
    }
  }
}
