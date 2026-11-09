import type {
  AcpRecoveryScope,
  AcpResourceDiagnostics,
  AcpResourceRecord,
  AcpResourceOptions,
  AcpResourceSnapshot,
} from "@/definition/AcpResource";
import type { AcpResourceStore } from "./AcpResourceStore";

export type { AcpRecoveryScope } from "@/definition/AcpResource";

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
    return (await this.store.list()).filter((record) => this.owns(record));
  }

  /** Whether this process role recovers and checks the lease; foreign leases only count. */
  public owns(record: AcpResourceRecord): boolean {
    return (
      this.scope === "all" ||
      (this.scope === "plans" ? record.runId !== null : record.runId === null)
    );
  }

  /** The leases this process role is responsible for. */
  public recoveryScope(): AcpRecoveryScope {
    return this.scope;
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

  /**
   * Global occupancy is visible without importing foreign leases into the cleanup map.
   *
   * @param describe - Adds process facts and the last check to each lease.
   * @returns All leases and the plan names of the runs that hold them.
   */
  public async records(
    describe: (
      record: AcpResourceRecord,
    ) => AcpResourceSnapshot["active"][number],
  ): Promise<Pick<AcpResourceDiagnostics, "active" | "runs">> {
    const active = (await this.store.list()).map(describe);
    const runIds = [...new Set(active.flatMap((record) => record.runId ?? []))];
    return {
      active,
      runs: this.store.runReferences
        ? await this.store.runReferences(runIds)
        : [],
    };
  }
}
