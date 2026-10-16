import type { AcpResourceRecord } from "@/definition/AcpResource";

/** Persistence boundary: a reservation must be durable before native process creation. */
export interface AcpResourceStore {
  list(): Promise<readonly AcpResourceRecord[]>;
  save(record: AcpResourceRecord): Promise<void>;
  remove(instanceId: string): Promise<void>;
}
