import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { WaitingRequest } from "./AcpAdmissionRequest";
import type { AcpResourceRecord } from "@/definition/AcpResource";

/**
 * What the admission pump needs from the scheduler. The scheduler owns the
 * state; the pump only decides in which order waiting requests are admitted.
 */
export interface AcpAdmissionHost {
  readonly active: Map<string, AcpResourceRecord>;
  readonly waiting: WaitingRequest[];
  isClosing(): boolean;
  isReady(): boolean;
  canAdmit(): boolean;
  capacity(): number;
  isPaused(request: WaitingRequest): boolean;
  refreshOptions(): Promise<void>;
  recheckBlockingLeases(): Promise<void>;
  reclaimIdleSession(): void;
  probeMemory(): Promise<void>;
  memoryBlocksAdmission(): boolean;
  reserve(record: AcpResourceRecord): Promise<boolean>;
  storageFailed(record: AcpResourceRecord, error: unknown): void;
  markStorageProblem(): void;
  publishWaiting(): Promise<void>;
}

/** Serves the waiting requests of the scheduler in FIFO order, one pass at a time. */
export class AcpAdmissionPump {
  private readonly host: AcpAdmissionHost;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private isPumping = false;
  private hasPendingWake = false;

  public constructor(host: AcpAdmissionHost) {
    this.host = host;
  }

  /** Starts a pass now, or marks the running pass to run once more. */
  public wake(): void {
    if (this.host.isClosing()) return;
    if (this.isPumping) {
      this.hasPendingWake = true;
      return;
    }
    this.hasPendingWake = false;
    clearTimeout(this.timer);
    this.isPumping = true;
    // Whoever wakes it, the scheduler serves the sessions of everyone.
    void withBackgroundDatabaseWork("acp_resources", () => this.pump())
      .catch((caughtError: unknown) => {
        logCaughtError("AcpResourceScheduler", caughtError);
        this.host.markStorageProblem();
      })
      .finally(() => {
        this.isPumping = false;
        if (this.host.waiting.length === 0 || this.host.isClosing()) return;
        if (this.hasPendingWake) this.wake();
        else this.timer = setTimeout(() => this.wake(), 1000).unref();
      });
  }

  /** Cancels the retry timer of a waiting queue that is shutting down. */
  public cancelTimer(): void {
    clearTimeout(this.timer);
  }

  private async pump(): Promise<void> {
    try {
      await this.admitWaiting();
    } finally {
      await this.host.publishWaiting();
    }
  }

  private async admitWaiting(): Promise<void> {
    await this.host.refreshOptions();
    await this.host.recheckBlockingLeases();
    // An idle chat session gives its place to a waiting start; its closeout wakes the queue.
    if (
      this.host.isReady() &&
      this.host.active.size >= this.host.capacity() &&
      this.host.waiting.some((request) => !this.host.isPaused(request))
    )
      this.host.reclaimIdleSession();
    while (this.host.canAdmit()) {
      const request = this.host.waiting.find(
        (entry) => !this.host.isPaused(entry),
      );
      if (!request) return;
      await this.host.probeMemory();
      // A live reduction or shutdown may have happened during the memory probe.
      if (!this.host.canAdmit() || this.host.memoryBlocksAdmission()) return;
      if (
        request.signal.aborted ||
        !this.host.waiting.includes(request) ||
        this.host.isPaused(request)
      )
        continue;
      this.host.waiting.splice(this.host.waiting.indexOf(request), 1);
      request.signal.removeEventListener("abort", request.abort);
      const record: AcpResourceRecord = {
        ...request.owner,
        state: "starting",
        since: request.since,
        lifecycle: "reserved",
      };
      this.host.active.set(record.instanceId, record);
      try {
        const reserved = await this.host.reserve(record);
        if (!reserved) {
          this.deferRequest(request);
          return;
        }
        request.resolve();
      } catch (caughtError: unknown) {
        this.host.storageFailed(record, caughtError);
        request.reject(new Error("ACP reservation could not be persisted"));
      }
    }
  }

  private deferRequest(request: WaitingRequest): void {
    this.host.active.delete(request.owner.instanceId);
    if (request.signal.aborted) {
      request.reject(new AgentPlanCancelledError());
      return;
    }
    this.host.waiting.unshift(request);
    request.signal.addEventListener("abort", request.abort, { once: true });
  }
}
