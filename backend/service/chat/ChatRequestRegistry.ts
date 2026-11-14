import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { logCaughtError } from "@/backend/logging/Logger";

/**
 * Whom a request excludes while it runs.
 *
 * @remarks
 * `person` is one answer per account, for Pica and the API path: a second
 * one of the same account is refused. `session` is a job of an agent
 * employee (PAGE-304): it excludes only its own job ID, so one agent
 * answers in several chats at once; its own limits per agent and in total
 * queue its jobs before they reach this registry.
 */
export type ChatRequestAdmission = "person" | "session";

interface PendingRequest {
  readonly userId: string;
  readonly admission: ChatRequestAdmission;
  readonly controller: AbortController;
  readonly completed: Promise<unknown>;
}

/** Deadline of one request and how many requests may run at once. */
export interface ChatRequestLimits {
  readonly timeoutMs: number;
  readonly capacity: number;
}

/** Pins cancellation to the owning user and drains requests before database shutdown. */
export class ChatRequestRegistry {
  private readonly requests = new Map<string, PendingRequest>();
  private readonly limits: ChatRequestLimits;
  private isStopped = false;
  private isCancelling = false;

  public constructor(
    limits: ChatRequestLimits = { timeoutMs: 120_000, capacity: 8 },
  ) {
    this.limits = limits;
  }

  /** Registers synchronously before asynchronous preflight, with a bounded overall deadline. */
  public async run<Result>(
    userId: string,
    id: string,
    work: (signal: AbortSignal) => Promise<Result>,
    admission: ChatRequestAdmission = "person",
  ): Promise<Result> {
    this.requireAdmission(userId, id, admission);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort("timeout"),
      this.limits.timeoutMs,
    );
    const operation = Promise.resolve().then(() => work(controller.signal));
    this.requests.set(id, {
      userId,
      admission,
      controller,
      completed: operation,
    });
    try {
      const result = await operation;
      controller.signal.throwIfAborted();
      return result;
    } catch (error: unknown) {
      logCaughtError("ChatRequestRegistry", error);

      if (controller.signal.aborted)
        throw new AgentExecutionError(
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
   * @remarks
   * Its database jobs leave the request (PAGE-199). A person stops it through
   * {@link cancel}, a server stop through {@link shutdown}.
   *
   * @returns The running work; it settles like {@link run}.
   * @throws {AgentExecutionError} `requestBusy` synchronously, before anything runs.
   */
  public start<Result>(
    userId: string,
    id: string,
    work: (signal: AbortSignal) => Promise<Result>,
    admission: ChatRequestAdmission = "person",
  ): Promise<Result> {
    this.requireAdmission(userId, id, admission);
    return withBackgroundDatabaseWork("pica_job", () =>
      this.run(userId, id, work, admission),
    );
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

  /** Cancels current Pica work without permanently shutting down the registry. */
  public async cancelAll(): Promise<void> {
    this.isCancelling = true;
    try {
      const pending = [...this.requests.values()].filter(
        (request) => request.admission === "person",
      );
      for (const request of pending) request.controller.abort("cancelled");
      await Promise.allSettled(pending.map((request) => request.completed));
    } finally {
      this.isCancelling = false;
    }
  }

  /**
   * Refuses work that {@link run} would refuse, before the caller stores anything for it.
   *
   * @remarks
   * Before PAGE-304 every request excluded every other one of its account,
   * so the job of an agent in one chat refused its answer in every other
   * chat. A `session` request is therefore checked against its own ID only
   * and does not count towards the capacity of the `person` requests.
   *
   * @throws {AgentExecutionError} `requestBusy`.
   */
  public requireAdmission(
    userId: string,
    id: string,
    admission: ChatRequestAdmission = "person",
  ): void {
    if (this.isStopped || this.isCancelling || this.requests.has(id))
      throw new AgentExecutionError("requestBusy");
    if (admission === "session") return;
    const personal = [...this.requests.values()].filter(
      (entry) => entry.admission === "person",
    );
    if (
      personal.length >= this.limits.capacity ||
      personal.some((entry) => entry.userId === userId)
    )
      throw new AgentExecutionError("requestBusy");
  }
}
