import { acpMemoryWaitReason } from "./AcpMemory";
import { MAX_ACP_SESSIONS } from "@/definition/AcpResource";

import type { AcpLeaseChecks } from "./AcpLeaseChecks";
import type { WaitingRequest } from "./AcpAdmissionRequest";
import type {
  AcpResourceLimitSource,
  AcpResourceOptions,
  AcpResourceRecord,
  AcpResourceSnapshot,
  AcpWaitReason,
} from "@/definition/AcpResource";

/** The concurrency cap: `0` means the environment default. */
export function acpAdmissionCap(options: AcpResourceOptions): number {
  return options.maxConcurrentAcpSessions === 0
    ? MAX_ACP_SESSIONS
    : options.maxConcurrentAcpSessions;
}

/** A paused run keeps its place in the FIFO queue; its leases stay alive. */
export function isAcpRequestPaused(
  pausedRuns: ReadonlySet<string>,
  request: WaitingRequest,
): boolean {
  return request.owner.runId !== null && pausedRuns.has(request.owner.runId);
}

/** The inputs a wait reason is derived from, read at the moment of the question. */
export interface AcpWaitReasonInput {
  readonly isPaused: boolean;
  readonly isReady: boolean;
  readonly problem: AcpResourceSnapshot["problem"];
  readonly activeCount: number;
  readonly cap: number;
  readonly options: AcpResourceOptions;
  readonly availableMemory: number | null;
}

/** Why a waiting request cannot start yet; shown secret-free to administrators. */
export function acpRequestWaitReason(input: AcpWaitReasonInput): AcpWaitReason {
  if (input.isPaused) return "paused";
  if (!input.isReady) return "recovery";
  if (input.problem) return "scheduler_error";
  if (input.activeCount >= input.cap) return "capacity";
  return (
    acpMemoryWaitReason(input.options, input.availableMemory) ?? "capacity"
  );
}

/** The state a snapshot is built from, read at the moment of the question. */
export interface AcpResourceSnapshotState {
  readonly options: AcpResourceOptions;
  readonly limitSource: AcpResourceLimitSource;
  readonly availableMemory: number | null;
  readonly problem: AcpResourceSnapshot["problem"];
  readonly isReady: boolean;
  readonly active: readonly AcpResourceRecord[];
  readonly waiting: readonly WaitingRequest[];
  readonly pausedRuns: ReadonlySet<string>;
  readonly cap: number;
}

/** Returns secret-free global diagnostics; callers must require administrative access. */
export function buildAcpResourceSnapshot(
  checks: AcpLeaseChecks,
  state: AcpResourceSnapshotState,
): AcpResourceSnapshot {
  return {
    options: state.options,
    limitSource: state.limitSource,
    availableMemory: state.availableMemory,
    problem: state.problem,
    check: checks.summary(),
    active: state.active.map((entry) => checks.describe(entry)),
    waiting: state.waiting.map((request) => ({
      ...request.owner,
      since: request.since,
      reason: acpRequestWaitReason({
        isPaused: isAcpRequestPaused(state.pausedRuns, request),
        isReady: state.isReady,
        problem: state.problem,
        activeCount: state.active.length,
        cap: state.cap,
        options: state.options,
        availableMemory: state.availableMemory,
      }),
    })),
  };
}
