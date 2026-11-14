import { reconcileAcpLeases } from "./AcpLeaseRecovery";

import { AgentError } from "@/backend/error/AgentErrors";

import type {
  AcpNamespaceOwner,
  AcpResourceRecord,
} from "@/definition/AcpResource";
import type { AcpResourceStore } from "./AcpResourceStore";

/** Persists the namespace supervisor owned by a starting lease. */
export async function registerAcpNamespace(
  store: AcpResourceStore,
  active: Map<string, AcpResourceRecord>,
  instanceId: string,
  namespace: AcpNamespaceOwner,
): Promise<void> {
  const current = active.get(instanceId);
  if (
    current?.namespace &&
    JSON.stringify(current.namespace) === JSON.stringify(namespace)
  )
    return;
  if (
    !current ||
    current.state === "closing" ||
    current.state === "cleanup_failed"
  )
    throw new Error("ACP reservation is not starting");
  if (
    current.namespace &&
    JSON.stringify(current.namespace) !== JSON.stringify(namespace)
  )
    throw new Error("ACP namespace identity changed");
  const record = { ...current, namespace, lifecycle: "process" as const };
  await store.save(record);
  active.set(instanceId, record);
}

/** Reconciles a failed session close using its lease identity. */
export async function settleAcpSessionLease(
  record: AcpResourceRecord | undefined,
  error: unknown,
  cleanup: (
    record: AcpResourceRecord,
  ) => Promise<{ readonly remaining: number }>,
): Promise<boolean> {
  if (!record) return true;
  if (
    record.runId !== null &&
    (!(error instanceof AgentError) ||
      (error.code !== "plan_local_control_failed" &&
        error.code !== "plan_local_owner_unverified"))
  )
    return false;
  return (await cleanup(record)).remaining === 0;
}

/** Retries cleanup of an ended run's uncertain leases without active sessions. */
export async function reconcileAcpRunLeases(
  runId: string,
  active: Map<string, AcpResourceRecord>,
  sessions: ReadonlyMap<string, unknown>,
  actions: Parameters<typeof reconcileAcpLeases>[1],
): Promise<void> {
  await reconcileAcpLeases(
    [...active.values()].filter(
      (record) =>
        record.state === "cleanup_failed" &&
        !sessions.has(record.instanceId) &&
        record.runId === runId,
    ),
    actions,
  );
}
