/** Counts execution time while retaining the remaining budget during a pause. */
export class CliPausableDeadline {
  private remaining: number;
  private startedAt = Date.now();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly expire: () => void;

  public constructor(milliseconds: number, expire: () => void) {
    this.remaining = milliseconds;
    this.expire = expire;
    this.resume();
  }

  /** Stops counting time without changing the remaining execution budget. */
  public pause(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.remaining = Math.max(
      1,
      this.remaining - (Date.now() - this.startedAt),
    );
  }

  /** Continues counting the saved budget; repeated resumes are harmless. */
  public resume(): void {
    if (this.timer !== undefined || this.remaining <= 0) return;
    this.startedAt = Date.now();
    this.timer = setTimeout(this.expire, this.remaining);
  }

  /** Releases the timer permanently after process exit. */
  public close(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.remaining = 0;
  }
}
