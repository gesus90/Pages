import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

/** Public retry information; all error text is fixed and credential-free. */
export class PairingRateError extends McpAuthorizationError {
  public readonly retryAfter: number;

  public constructor(retryAfter: number) {
    super("slow_down", 429);
    this.retryAfter = retryAfter;
  }
}

/** Socket identity plus an optional, untrusted proxy key; neither grants access. */
export interface PairingAddress {
  readonly socket: string;
  readonly forwarded: string | null;
}

/** Bounded process-local request and failed-code limits. */
export class PairingThrottle {
  private readonly requests = new Map<string, number[]>();
  private readonly failures = new Map<
    string,
    { attempts: number[]; lockedUntil: number }
  >();
  private readonly open = new Map<
    string,
    { keys: readonly string[]; expiresAt: number }
  >();

  /** Enforces minute, hour and open-request limits before creating a request. */
  public request(address: PairingAddress): void {
    const now = Date.now();
    this.prune(now);
    const keys = this.addressKeys(address);
    for (const key of keys) {
      const attempts = (this.requests.get(key) ?? []).filter(
        (time) => time > now - 3_600_000,
      );
      this.requests.set(key, attempts);
      if (attempts.filter((time) => time > now - 60_000).length >= 5)
        throw new PairingRateError(60);
      if (attempts.length >= 20) throw new PairingRateError(3600);
      if (
        [...this.open.values()].filter((entry) => entry.keys.includes(key))
          .length >= 10
      )
        throw new PairingRateError(600);
    }
    for (const key of keys) this.requests.get(key)?.push(now);
  }

  /** Tracks uncollected requests; the global cap is additionally enforced in SQL. */
  public started(id: string, address: PairingAddress, expiresAt: number): void {
    this.open.set(id, { keys: this.addressKeys(address), expiresAt });
  }

  /** Keeps a late approval open for its complete collection grace period. */
  public approved(id: string, expiresAt: number): void {
    const request = this.open.get(id);
    if (request) request.expiresAt = Math.max(request.expiresAt, expiresAt);
  }

  /** Releases a request when it is denied, consumed or cancelled. */
  public ended(id: string): void {
    this.open.delete(id);
  }

  /** Blocks repeated invalid codes per account and actual socket address. */
  public browser(
    userId: string,
    address: PairingAddress,
    isFailure = false,
  ): void {
    const now = Date.now();
    this.prune(now);
    for (const key of [`user:${userId}`, ...this.addressKeys(address)]) {
      const state = this.failures.get(key) ?? { attempts: [], lockedUntil: 0 };
      state.attempts = state.attempts.filter((time) => time > now - 900_000);
      if (state.lockedUntil > now)
        throw new PairingRateError(Math.ceil((state.lockedUntil - now) / 1000));
      if (isFailure) {
        state.attempts.push(now);
        if (state.attempts.length >= 10) state.lockedUntil = now + 900_000;
      }
      this.failures.set(key, state);
    }
  }

  private addressKeys(address: PairingAddress): string[] {
    return [
      `socket:${address.socket}`,
      ...(address.forwarded
        ? [`proxy:${address.forwarded.slice(0, 200)}`]
        : []),
    ];
  }

  private prune(now: number): void {
    for (const [id, entry] of this.open)
      if (entry.expiresAt <= now) this.open.delete(id);
    for (const [key, attempts] of this.requests)
      if ((attempts.at(-1) ?? 0) <= now - 3_600_000) this.requests.delete(key);
    for (const [key, state] of this.failures)
      if (
        state.lockedUntil <= now &&
        (state.attempts.at(-1) ?? 0) <= now - 900_000
      )
        this.failures.delete(key);
    if (this.requests.size + this.failures.size > 10_000)
      throw new PairingRateError(900);
  }
}
