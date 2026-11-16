import { acpMemoryWaitReason } from "./AcpMemory";
import { enqueueAcpRequest } from "./AcpAdmissionRequest";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { WaitingRequest } from "./AcpAdmissionRequest";
import type {
  AcpResourceOptions,
  AcpResourceOwner,
  AcpResourceRecord,
  AcpResourceSnapshot,
} from "@/definition/AcpResource";

/**
 * The scheduler side of FIFO admission, as the admission loop sees it.
 *
 * @remarks
 * Live values are read through functions so the loop observes reductions and
 * shutdowns that happen while it runs.
 */
export interface AcpAdmissionController {
  isReady(): boolean;
  isClosing(): boolean;
  problem(): AcpResourceSnapshot["problem"];
  options(): AcpResourceOptions;
  availableMemory(): number | null;
  readonly active: Map<string, AcpResourceRecord>;
  readonly waiting: WaitingRequest[];
  memory(): Promise<number | null>;
  refreshOptions(): Promise<void>;
  recheckBlockingLeases(): Promise<void>;
  reclaimIdle?(): boolean;
  isPaused(request: WaitingRequest): boolean;
  cap(): number;
  probeMemory(): Promise<void>;
  reserve(record: AcpResourceRecord): Promise<boolean>;
  defer(request: WaitingRequest): void;
  storageFailed(record: AcpResourceRecord, error: unknown): void;
}

/** Whether a start may be admitted now. */
export function acpCanAdmit(controller: AcpAdmissionController): boolean {
  return (
    controller.isReady() &&
    !controller.isClosing() &&
    !controller.problem() &&
    controller.active.size < controller.cap()
  );
}

/** Admits waiting starts in FIFO order until capacity, memory or a blocking lease stops it. */
export async function admitAcpWaiting(
  controller: AcpAdmissionController,
): Promise<void> {
  await controller.refreshOptions();
  await controller.recheckBlockingLeases();
  // An idle chat session gives its place to a waiting start; its closeout wakes the queue.
  if (
    controller.isReady() &&
    controller.active.size >= controller.cap() &&
    controller.waiting.some((request) => !controller.isPaused(request))
  )
    controller.reclaimIdle?.();
  while (acpCanAdmit(controller)) {
    const request = controller.waiting.find(
      (entry) => !controller.isPaused(entry),
    );
    if (!request) return;
    await controller.probeMemory();
    // A live reduction or shutdown may have happened during the memory probe.
    if (
      !acpCanAdmit(controller) ||
      acpMemoryWaitReason(controller.options(), controller.availableMemory())
    )
      return;
    if (
      request.signal.aborted ||
      !controller.waiting.includes(request) ||
      controller.isPaused(request)
    )
      continue;
    controller.waiting.splice(controller.waiting.indexOf(request), 1);
    request.signal.removeEventListener("abort", request.abort);
    const record: AcpResourceRecord = {
      ...request.owner,
      state: "starting",
      since: request.since,
      lifecycle: "reserved",
    };
    controller.active.set(record.instanceId, record);
    try {
      const reserved = await controller.reserve(record);
      if (!reserved) {
        controller.defer(request);
        return;
      }
      request.resolve();
    } catch (caughtError: unknown) {
      controller.storageFailed(record, caughtError);
      request.reject(new Error("ACP reservation could not be persisted"));
    }
  }
}

/** The reservation side of FIFO admission the scheduler provides. */
export interface AcpAcquisitionContext {
  isClosing(): boolean;
  readonly active: Map<string, AcpResourceRecord>;
  readonly waiting: WaitingRequest[];
  wake(): void;
}

/** Reserves a start's place in the FIFO queue or refuses an already reserved instance. */
export function acquireAcpRequest(
  context: AcpAcquisitionContext,
  owner: AcpResourceOwner,
  signal: AbortSignal,
  deadlineMs?: number,
): Promise<void> {
  if (signal.aborted || context.isClosing())
    return Promise.reject(new AgentPlanCancelledError());
  if (
    context.active.has(owner.instanceId) ||
    context.waiting.some((entry) => entry.owner.instanceId === owner.instanceId)
  )
    return Promise.reject(new Error("ACP instance already reserved"));
  return enqueueAcpRequest(
    { waiting: context.waiting, wake: () => context.wake() },
    owner,
    signal,
    deadlineMs,
  );
}

/** Puts a not-yet-reserved request back at the head of the queue and watches for its abort. */
export function deferAcpRequest(
  active: Map<string, AcpResourceRecord>,
  waiting: WaitingRequest[],
  request: WaitingRequest,
): void {
  active.delete(request.owner.instanceId);
  if (request.signal.aborted) {
    request.reject(new AgentPlanCancelledError());
    return;
  }
  waiting.unshift(request);
  request.signal.addEventListener("abort", request.abort, { once: true });
}

/** Records a failed durable reservation write as a scheduler problem. */
export function markAcpStorageFailed(
  active: Map<string, AcpResourceRecord>,
  record: AcpResourceRecord,
  error: unknown,
  markProblem: () => void,
): void {
  logCaughtError("AcpResourceScheduler", error);
  markProblem();
  active.set(record.instanceId, { ...record, state: "cleanup_failed" });
}
