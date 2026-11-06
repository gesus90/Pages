import type {
  AcpResourceRecord,
  AcpResourceOptions,
  AcpResourceSnapshot,
} from "@/definition/AcpResource";
import type { AcpResourceStore } from "./AcpResourceStore";

/** Recovery owns plan or chat leases separately when the engine runs outside the API. */
export type AcpRecoveryScope = "all" | "plans" | "chat";

/** Atomic shared admission and read-only diagnostics, separate from process cleanup ownership. */
export class AcpLeaseAdmission {
  private readonly store: AcpResourceStore;
  private readonly scope: AcpRecoveryScope;
  private readonly readOptions: (() => Promise<AcpResourceOptions>) | undefined;

  public constructor(
    store: AcpResourceStore,
    scope: AcpRecoveryScope,
    readOptions?: () => Promise<AcpResourceOptions>,
  ) {
    this.store = store;
    this.scope = scope;
    this.readOptions = readOptions;
  }

  /** Lists only leases this process role is authorized to recover. */
  public async recoverable(): Promise<readonly AcpResourceRecord[]> {
    return (await this.store.list()).filter(
      (record) =>
        this.scope === "all" ||
        (this.scope === "plans"
          ? record.runId !== null
          : record.runId === null),
    );
  }

  /** Serial stores may save directly; the PostgreSQL runtime implements atomic shared reservation. */
  public async reserve(
    record: AcpResourceRecord,
    limit: number,
  ): Promise<boolean> {
    if (this.store.tryReserve) return this.store.tryReserve(record, limit);
    await this.store.save(record);
    return true;
  }

  /** Refreshes persisted options in separate mode before admitting another native process. */
  public options(current: AcpResourceOptions): Promise<AcpResourceOptions> {
    return this.readOptions ? this.readOptions() : Promise.resolve(current);
  }

  /** Global occupancy is visible without importing foreign leases into the cleanup map. */
  public async records(
    pausedRuns: ReadonlySet<string>,
  ): Promise<AcpResourceSnapshot["active"]> {
    return (await this.store.list()).map((record) => ({
      ...record,
      isPaused: record.runId !== null && pausedRuns.has(record.runId),
    }));
  }
}
