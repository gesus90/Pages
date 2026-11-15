import { MAX_ACP_SESSIONS } from "@/definition/AcpResource";

import { acpMemoryWaitReason } from "./AcpMemory";

import type {
  AcpResourceOptions,
  AcpResourceSnapshot,
  AcpWaitReason,
} from "@/definition/AcpResource";

/** The facts that decide why a waiting request is not admitted yet. */
export interface AcpWaitState {
  readonly isPaused: boolean;
  readonly isReady: boolean;
  readonly problem: AcpResourceSnapshot["problem"];
  readonly activeCount: number;
  readonly availableMemory: number | null;
}

/** The number of sessions that may hold a lease at once; `0` means the product maximum. */
export function admissionCapacity(options: AcpResourceOptions): number {
  return options.maxConcurrentAcpSessions === 0
    ? MAX_ACP_SESSIONS
    : options.maxConcurrentAcpSessions;
}

/** Why a waiting request is not admitted now; a request waits for the first reason that holds. */
export function acpWaitReason(
  options: AcpResourceOptions,
  state: AcpWaitState,
): AcpWaitReason {
  if (state.isPaused) return "paused";
  if (!state.isReady) return "recovery";
  if (state.problem) return "scheduler_error";
  if (state.activeCount >= admissionCapacity(options)) return "capacity";
  return acpMemoryWaitReason(options, state.availableMemory) ?? "capacity";
}
