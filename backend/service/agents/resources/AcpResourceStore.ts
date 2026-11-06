import type { AcpResourceRecord } from "@/definition/AcpResource";

/** Persistence boundary: a reservation must be durable before native process creation. */
export interface AcpResourceStore {
  list(): Promise<readonly AcpResourceRecord[]>;
  save(record: AcpResourceRecord): Promise<void>;
  /** Reserves capacity across service processes before a native process may spawn. */
  tryReserve?(record: AcpResourceRecord, limit: number): Promise<boolean>;
  remove(instanceId: string): Promise<void>;
}
