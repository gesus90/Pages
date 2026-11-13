import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";

import type {
  PlanSession,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type { AcpResourceOwner } from "@/definition/AcpResource";
import type { AcpStartLifecycle } from "./AcpStartLifecycle";

/** One opening of a session: who asks, its stop signal, its start and its observer. */
export interface AcpOpenRequest {
  readonly owner: AcpResourceOwner;
  readonly signal: AbortSignal;
  readonly start: (
    signal: AbortSignal,
    lifecycle: AcpStartLifecycle,
  ) => Promise<PlanSession>;
  readonly observer?: PlanSessionObserver;
  /** Gives up waiting for a place after this long, without taking one (PAGE-313). */
  readonly deadlineMs?: number;
}

/** One request that waits for an ACP place in FIFO order. */
export interface WaitingRequest {
  readonly owner: AcpResourceOwner;
  readonly since: string;
  readonly signal: AbortSignal;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly abort: () => void;
}

/**
 * No ACP place became free before the deadline of the request (PAGE-313).
 *
 * @remarks
 * The request left the queue without taking a place, so nothing has to be
 * released; the caller reports its session as not started.
 */
export class AcpAdmissionTimeoutError extends Error {
  public constructor() {
    super("No ACP place became free before the deadline");
    this.name = "AcpAdmissionTimeoutError";
  }
}

/**
 * Puts a request into the FIFO queue of the scheduler.
 *
 * @param queue - The waiting list of the scheduler and how to wake it.
 * @param owner - The session that asks for a place.
 * @param signal - Cancels the request while it waits.
 * @param deadlineMs - Gives up after this long; absent waits until admitted or cancelled.
 * @returns Resolves once the scheduler admitted the request; rejects with
 * {@link AgentPlanCancelledError} after a cancellation and with
 * {@link AcpAdmissionTimeoutError} after the deadline, both without a place.
 */
export function enqueueAcpRequest(
  queue: { readonly waiting: WaitingRequest[]; readonly wake: () => void },
  owner: AcpResourceOwner,
  signal: AbortSignal,
  deadlineMs?: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const leave = (error: Error): void => {
      clearTimeout(timer);
      const index = queue.waiting.indexOf(request);
      if (index < 0) return;
      queue.waiting.splice(index, 1);
      signal.removeEventListener("abort", request.abort);
      reject(error);
      queue.wake();
    };
    const request: WaitingRequest = {
      owner,
      signal,
      since: new Date().toISOString(),
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
      abort: () => leave(new AgentPlanCancelledError()),
    };
    queue.waiting.push(request);
    signal.addEventListener("abort", request.abort, { once: true });
    if (deadlineMs !== undefined)
      timer = setTimeout(
        () => leave(new AcpAdmissionTimeoutError()),
        deadlineMs,
      );
    if (signal.aborted) request.abort();
    queue.wake();
  });
}
