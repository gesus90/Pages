/** One virtual lock of a file in the working directory of a swarm. */
export interface SwarmLock {
  /** The normalized file path. */
  readonly path: string;
  /** The helper that holds it, `H1` … `H10`. */
  readonly owner: string;
  /** Epoch milliseconds after which the lock is gone unless its owner renews it. */
  readonly expiresAt: number;
}

/** How a lock request ended: the lock is held, or another helper holds it. */
export type SwarmLockOutcome =
  | { readonly status: "locked"; readonly path: string }
  | {
      readonly status: "taken";
      readonly path: string;
      readonly owner: string;
    };

/**
 * The virtual lock list of one swarm run (PAGE-313).
 *
 * @remarks
 * No `.lock` file is ever written into the repository. A request never
 * waits: it answers at once with the lock or with the helper that holds it.
 * Every lock has an owner and an expiry, which its owner extends while it
 * lives; a lock whose owner ended or stopped renewing is gone.
 */
export class SwarmLockTable {
  private readonly locks = new Map<string, SwarmLock>();
  private readonly now: () => number;
  private readonly leaseMs: number;

  /**
   * Creates an empty list.
   *
   * @param now - The clock in epoch milliseconds.
   * @param leaseMs - How long a lock lives without renewal.
   */
  public constructor(now: () => number, leaseMs: number) {
    this.now = now;
    this.leaseMs = leaseMs;
  }

  /**
   * Locks a file for a helper, or names the helper that holds it.
   *
   * @param owner - The asking helper.
   * @param path - A normalized file path.
   */
  public lock(owner: string, path: string): SwarmLockOutcome {
    this.expire();
    const current = this.locks.get(path);
    if (current && current.owner !== owner)
      return { status: "taken", path, owner: current.owner };
    this.locks.set(path, {
      path,
      owner,
      expiresAt: this.now() + this.leaseMs,
    });
    return { status: "locked", path };
  }

  /**
   * Releases one lock of its owner.
   *
   * @returns Whether the owner held it.
   */
  public unlock(owner: string, path: string): boolean {
    const current = this.locks.get(path);
    if (current?.owner !== owner) return false;
    this.locks.delete(path);
    return true;
  }

  /**
   * Releases every lock of a helper, when its subtask ends, is cancelled or it crashes.
   *
   * @returns The released paths.
   */
  public releaseOwner(owner: string): readonly string[] {
    const released = this.held(owner);
    for (const path of released) this.locks.delete(path);
    return released;
  }

  /** Extends every lock of a living helper by one lease. */
  public renew(owner: string): void {
    const expiresAt = this.now() + this.leaseMs;
    for (const lock of this.locks.values())
      if (lock.owner === owner)
        this.locks.set(lock.path, { ...lock, expiresAt });
  }

  /**
   * Drops every lock whose lease ran out.
   *
   * @returns The owners whose locks ran out, each once.
   */
  public expire(): readonly string[] {
    const now = this.now();
    const owners = new Set<string>();
    for (const lock of [...this.locks.values()]) {
      if (lock.expiresAt > now) continue;
      this.locks.delete(lock.path);
      owners.add(lock.owner);
    }
    return [...owners];
  }

  /** The paths a helper holds, sorted. */
  public held(owner: string): readonly string[] {
    return [...this.locks.values()]
      .filter((lock) => lock.owner === owner)
      .map((lock) => lock.path)
      .sort();
  }

  /** Every lock, sorted by path. */
  public list(): readonly SwarmLock[] {
    this.expire();
    return [...this.locks.values()].sort((first, second) =>
      first.path.localeCompare(second.path),
    );
  }

  /** Drops every lock, as a resumed run does: helper sessions are never revived. */
  public clear(): void {
    this.locks.clear();
  }
}
