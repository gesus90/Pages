import { recoverAcpLease } from "./AcpLeaseRecovery";

import type { PlanSession } from "@/backend/agents/AgentPlanExecution";
import type {
  AcpResourceOwner,
  AcpResourceRecord,
  AcpResourceState,
} from "@/definition/AcpResource";
import type { AcpResourceStore } from "./AcpResourceStore";

interface StartupRecoveryHost {
  readonly active: Map<string, AcpResourceRecord>;
  readonly store: AcpResourceStore;
  persist<Result>(task: () => Promise<Result>): Promise<Result>;
  transition(id: string, state: AcpResourceState): Promise<void>;
  cleanup(
    record: AcpResourceRecord,
    since: string | null,
  ): Promise<{ readonly remaining: number }>;
  finish(id: string, confirmed: boolean): Promise<boolean>;
}

/** Restores persisted and legacy leases before the scheduler admits work. */
export async function recoverStartupLeases(
  previous: readonly AcpResourceRecord[],
  owners: readonly AcpResourceOwner[],
  context: {
    readonly preserved: ReadonlySet<string>;
    readonly retained: ReadonlySet<string>;
  },
  host: StartupRecoveryHost,
): Promise<void> {
  for (const record of previous) host.active.set(record.instanceId, record);
  const adopted = new Set<string>();
  for (const owner of owners) {
    if (host.active.has(owner.instanceId)) continue;
    const record: AcpResourceRecord = {
      ...owner,
      state: "starting",
      since: new Date().toISOString(),
    };
    host.active.set(record.instanceId, record);
    adopted.add(record.instanceId);
    await host.persist(() => host.store.save(record));
  }
  for (const record of host.active.values())
    await recoverAcpLease(record, { ...context, adopted }, host);
}

/** Removes reservations of an ended run in the caller's serial write. */
export async function removeResumeLeases(
  runId: string,
  store: AcpResourceStore,
  active: Map<string, AcpResourceRecord>,
  sessions: Map<string, PlanSession>,
): Promise<void> {
  const stored = await store.list();
  const records = new Map(
    [...stored, ...active.values()].map((record) => [
      record.instanceId,
      record,
    ]),
  );
  for (const record of records.values()) {
    if (record.runId !== runId) continue;
    await store.remove(record.instanceId);
    active.delete(record.instanceId);
    sessions.delete(record.instanceId);
  }
}
