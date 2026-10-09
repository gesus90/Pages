import type { AssistantConversationRepository } from "@/backend/database/repositories/assistant/AssistantConversationRepository";

/** Deletes expired histories even when nobody opens the assistant. */
export class AssistantHistoryScheduler {
  private readonly repository: AssistantConversationRepository;
  private timer: NodeJS.Timeout | null = null;
  private pending: Promise<void> | null = null;

  public constructor(repository: AssistantConversationRepository) {
    this.repository = repository;
  }

  /** Runs at startup and then hourly, without overlapping database work. */
  public start(): void {
    if (this.timer !== null) return;
    void this.runOnce();
    this.timer = setInterval(
      () => {
        void this.runOnce();
      },
      60 * 60 * 1000,
    );
    this.timer.unref();
  }

  /** Stops automatic work and drains an active sweep before shutdown. */
  public async shutdown(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.pending;
  }

  /** Reports only a fixed diagnostic; messages and credentials cannot enter logs. */
  public async runOnce(): Promise<void> {
    if (this.pending !== null) return;
    const operation = this.repository.sweep();
    this.pending = operation;
    try {
      await operation;
    } catch {
      console.warn("Pages could not delete expired assistant histories.");
    } finally {
      this.pending = null;
    }
  }
}
