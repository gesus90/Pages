import { TextAssistantError } from "@/backend/error/TextAssistantErrors";

interface PendingRequest {
  readonly userId: string;
  readonly controller: AbortController;
  readonly completed: Promise<unknown>;
}

/** Pins cancellation to the owning user and drains requests before database shutdown. */
export class AssistantRequestRegistry {
  private readonly requests = new Map<string, PendingRequest>();
  private isStopped = false;

  /** Registers synchronously before asynchronous preflight, with a bounded overall deadline. */
  public async run<Result>(
    userId: string,
    id: string,
    work: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result> {
    if (
      this.isStopped ||
      this.requests.has(id) ||
      this.requests.size >= 8 ||
      [...this.requests.values()].some((entry) => entry.userId === userId)
    )
      throw new TextAssistantError("requestBusy");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), 120_000);
    const operation = Promise.resolve().then(() => work(controller.signal));
    this.requests.set(id, { userId, controller, completed: operation });
    try {
      const result = await operation;
      controller.signal.throwIfAborted();
      return result;
    } catch (error: unknown) {
      if (controller.signal.aborted)
        throw new TextAssistantError(
          controller.signal.reason === "timeout" ? "timeout" : "cancelled",
        );
      throw error;
    } finally {
      clearTimeout(timer);
      this.requests.delete(id);
    }
  }

  /** A forged cancellation cannot abort another user's request. */
  public cancel(userId: string, id: string): void {
    const pending = this.requests.get(id);
    if (pending?.userId === userId) pending.controller.abort("cancelled");
  }

  /** Stops new requests, cancels running work and waits for provider/DB cleanup. */
  public async shutdown(): Promise<void> {
    this.isStopped = true;
    const pending = [...this.requests.values()];
    for (const request of pending) request.controller.abort("cancelled");
    await Promise.allSettled(pending.map((request) => request.completed));
  }
}
