import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { logCaughtError } from "@/backend/logging/Logger";

interface PendingRequest {
  readonly userId: string;
  readonly controller: AbortController;
  readonly completed: Promise<unknown>;
}

/** Deadline of one request and how many requests may run at once. */
export interface AssistantRequestLimits {
  readonly timeoutMs: number;
  readonly capacity: number;
}

/** Pins cancellation to the owning user and drains requests before database shutdown. */
export class AssistantRequestRegistry {
  private readonly requests = new Map<string, PendingRequest>();
  private readonly limits: AssistantRequestLimits;
  private isStopped = false;

  public constructor(
    limits: AssistantRequestLimits = { timeoutMs: 120_000, capacity: 8 },
  ) {
    this.limits = limits;
  }

  /** Registers synchronously before asynchronous preflight, with a bounded overall deadline. */
  public async run<Result>(
    userId: string,
    id: string,
    work: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result> {
    this.requireAdmission(userId, id);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort("timeout"),
      this.limits.timeoutMs,
    );
    const operation = Promise.resolve().then(() => work(controller.signal));
    this.requests.set(id, { userId, controller, completed: operation });
    try {
      const result = await operation;
      controller.signal.throwIfAborted();
      return result;
    } catch (error: unknown) {
      logCaughtError("AssistantRequestRegistry", error);

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

  /**
   * Admits work that outlives the request which started it, such as a Pica job.
   *
   * @returns The running work; it settles like {@link run}.
   * @throws {TextAssistantError} `requestBusy` synchronously, before anything runs.
   */
  public start<Result>(
    userId: string,
    id: string,
    work: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result> {
    this.requireAdmission(userId, id);
    return this.run(userId, id, work);
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

  /**
   * Refuses work that {@link run} would refuse, before the caller stores anything for it.
   *
   * @throws {TextAssistantError} `requestBusy`.
   */
  public requireAdmission(userId: string, id: string): void {
    if (
      this.isStopped ||
      this.requests.has(id) ||
      this.requests.size >= this.limits.capacity ||
      [...this.requests.values()].some((entry) => entry.userId === userId)
    )
      throw new TextAssistantError("requestBusy");
  }
}
