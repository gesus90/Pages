import type {
  AcpLeaseCheck,
  AcpResourceRecord,
  AcpResourceRunReference,
} from "@/definition/AcpResource";

/** What a guarded release of an unconfirmed lease found. */
export type AcpLeaseRelease = "released" | "absent" | "changed";

/** Persistence boundary: a reservation must be durable before native process creation. */
export interface AcpResourceStore {
  list(): Promise<readonly AcpResourceRecord[]>;
  save(record: AcpResourceRecord): Promise<void>;
  /** Reserves capacity across service processes before a native process may spawn. */
  tryReserve?(record: AcpResourceRecord, limit: number): Promise<boolean>;
  remove(instanceId: string): Promise<void>;
  /** Deletes a lease only while it is still unconfirmed; see the periodic check. */
  releaseUncertain?(instanceId: string): Promise<AcpLeaseRelease>;
  /** Stores the last periodic check of a lease that stays unconfirmed. */
  recordCheck?(instanceId: string, result: AcpLeaseCheck): Promise<void>;
  /** Readable plan names of runs holding leases, for administrators only. */
  runReferences?(
    runIds: readonly string[],
  ): Promise<readonly AcpResourceRunReference[]>;
}
