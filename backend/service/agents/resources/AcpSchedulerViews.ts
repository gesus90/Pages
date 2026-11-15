import { controlOwnedNamespace } from "@/backend/agents/cli/CliNamespaceControl";

import type {
  AcpResourceRecord,
  AcpResourceSnapshot,
  AcpWaitReason,
} from "@/definition/AcpResource";
import type { WaitingRequest } from "./AcpAdmissionRequest";

/** Keeps queued requests of paused runs in their original position. */
export function isPausedWaiting(
  request: WaitingRequest,
  pausedRuns: ReadonlySet<string>,
): boolean {
  return request.owner.runId !== null && pausedRuns.has(request.owner.runId);
}

/** Controls the namespaces of every lease held by a run. */
export async function controlAcpRun(
  records: Iterable<AcpResourceRecord>,
  runId: string,
  action: "pause" | "resume" | "stop",
): Promise<void> {
  await Promise.all(
    [...records]
      .filter((record) => record.runId === runId)
      .map(async (record) => {
        if (record.namespace)
          await controlOwnedNamespace(record.namespace, action);
      }),
  );
}

/** Builds a secret-free view of active and waiting leases. */
export function schedulerSnapshot(input: {
  readonly state: Pick<
    AcpResourceSnapshot,
    "options" | "limitSource" | "availableMemory" | "problem" | "check"
  >;
  readonly active: Iterable<AcpResourceRecord>;
  readonly waiting: readonly WaitingRequest[];
  describe(record: AcpResourceRecord): AcpResourceSnapshot["active"][number];
  reason(request: WaitingRequest): AcpWaitReason;
}): AcpResourceSnapshot {
  return {
    ...input.state,
    active: [...input.active].map((entry) => input.describe(entry)),
    waiting: input.waiting.map((request) => ({
      ...request.owner,
      since: request.since,
      reason: input.reason(request),
    })),
  };
}
