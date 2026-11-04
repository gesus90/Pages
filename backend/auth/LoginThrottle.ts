const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_FAILURES_PER_USERNAME = 10;
const DEFAULT_MAX_FAILURES_PER_ADDRESS = 30;
const DEFAULT_MAX_TRACKED_KEYS = 10_000;

/** Raised when a login attempt is rejected because too many attempts failed. */
export class TooManyLoginAttemptsError extends Error {
  /** Seconds until the oldest counted failure leaves the observation window. */
  public readonly retryAfterSeconds: number;

  /**
   * Creates the error.
   *
   * @param retryAfterSeconds - Seconds the caller has to wait.
   */
  public constructor(retryAfterSeconds: number) {
    super("Too many failed login attempts.");
    this.name = "TooManyLoginAttemptsError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Limits and clock of a {@link LoginThrottle}; every value has a default. */
export interface LoginThrottleOptions {
  readonly windowMs?: number;
  readonly maxFailuresPerUsername?: number;
  readonly maxFailuresPerAddress?: number;
  readonly maxTrackedKeys?: number;
  readonly now?: () => number;
}

/**
 * Slows down password guessing by counting failed logins.
 *
 * @remarks
 * Failures are counted per username and, when the caller knows it, per client
 * address inside a sliding window. Unknown and known usernames are counted
 * identically, so the throttle reveals nothing about existing accounts. State
 * lives in memory of the single Pages process; a restart clears it. The
 * address is only as trustworthy as the proxy that supplies it, which is why
 * the username counter is always applied as well.
 */
export class LoginThrottle {
  private readonly failuresByKey = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxFailuresPerUsername: number;
  private readonly maxFailuresPerAddress: number;
  private readonly maxTrackedKeys: number;
  private readonly now: () => number;

  /**
   * Creates a throttle.
   *
   * @param options - Overrides for the limits and the clock.
   */
  public constructor(options: LoginThrottleOptions = {}) {
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxFailuresPerUsername =
      options.maxFailuresPerUsername ?? DEFAULT_MAX_FAILURES_PER_USERNAME;
    this.maxFailuresPerAddress =
      options.maxFailuresPerAddress ?? DEFAULT_MAX_FAILURES_PER_ADDRESS;
    this.maxTrackedKeys = options.maxTrackedKeys ?? DEFAULT_MAX_TRACKED_KEYS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Rejects the attempt when the username or address reached its limit.
   *
   * @param username - Username entered by the visitor.
   * @param clientAddress - Address of the visitor, when known.
   * @throws {TooManyLoginAttemptsError} When a limit is reached.
   */
  public assertAllowed(
    username: string,
    clientAddress: string | null | undefined,
  ): void {
    const retryAfterMs = Math.max(
      this.getRetryAfterMs(
        toUsernameKey(username),
        this.maxFailuresPerUsername,
      ),
      clientAddress
        ? this.getRetryAfterMs(
            toAddressKey(clientAddress),
            this.maxFailuresPerAddress,
          )
        : 0,
    );

    if (retryAfterMs > 0) {
      throw new TooManyLoginAttemptsError(Math.ceil(retryAfterMs / 1000));
    }
  }

  /**
   * Counts a failed attempt for the username and the address.
   *
   * @param username - Username entered by the visitor.
   * @param clientAddress - Address of the visitor, when known.
   */
  public recordFailure(
    username: string,
    clientAddress: string | null | undefined,
  ): void {
    this.addFailure(toUsernameKey(username));

    if (clientAddress) {
      this.addFailure(toAddressKey(clientAddress));
    }
  }

  /**
   * Forgets the failures of a username after a successful login.
   *
   * @param username - Username that signed in.
   */
  public recordSuccess(username: string): void {
    this.failuresByKey.delete(toUsernameKey(username));
  }

  private getRetryAfterMs(key: string, limit: number): number {
    const failures = this.getRecentFailures(key);

    if (failures.length < limit) {
      return 0;
    }

    // The block ends when enough old failures expired to drop below the limit.
    const releasingFailure = Math.min(...failures.slice(-limit));

    return Math.max(releasingFailure + this.windowMs - this.now(), 1);
  }

  private getRecentFailures(key: string): number[] {
    const threshold = this.now() - this.windowMs;
    const failures = (this.failuresByKey.get(key) ?? []).filter(
      (failedAt) => failedAt > threshold,
    );

    if (failures.length === 0) {
      this.failuresByKey.delete(key);
    } else {
      this.failuresByKey.set(key, failures);
    }

    return failures;
  }

  private addFailure(key: string): void {
    const failures = this.getRecentFailures(key);

    failures.push(this.now());
    this.failuresByKey.set(key, failures);
    this.limitTrackedKeys();
  }

  private limitTrackedKeys(): void {
    // Maps iterate in insertion order, so the oldest keys are dropped first.
    for (const key of this.failuresByKey.keys()) {
      if (this.failuresByKey.size <= this.maxTrackedKeys) {
        return;
      }

      this.failuresByKey.delete(key);
    }
  }
}

function toUsernameKey(username: string): string {
  return `user:${username.trim().toLowerCase()}`;
}

function toAddressKey(clientAddress: string): string {
  return `address:${clientAddress.trim().toLowerCase()}`;
}
