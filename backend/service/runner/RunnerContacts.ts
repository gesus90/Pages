/** Runners send a heartbeat every 15 seconds; three missed ones end the live window. */
const HEARTBEAT_MILLISECONDS = 45_000;

/** What Pages knows about a runner channel, independent of any remote process. */
export interface RunnerContact {
  readonly state: "connected" | "lost";
  readonly lastContactAt: string | null;
}

/** Transport liveness of authenticated runner channels, separate from job and process state. */
export class RunnerContacts {
  private readonly live = new Map<string, number>();
  private readonly last = new Map<string, number>();

  /** Records a validated message or heartbeat of the current channel. */
  public seen(connectionId: string): void {
    const now = Date.now();
    this.live.set(connectionId, now);
    this.last.set(connectionId, now);
  }

  /** Ends the live window of a closed socket; the last contact stays for diagnostics. */
  public forget(connectionId: string): void {
    this.live.delete(connectionId);
  }

  /** Whether the runner reported within the heartbeat window. */
  public isOnline(connectionId: string): boolean {
    return (
      Date.now() - (this.live.get(connectionId) ?? 0) < HEARTBEAT_MILLISECONDS
    );
  }

  /** The channel state with its last confirmed contact; an open socket alone proves no healthy run. */
  public contact(connectionId: string): RunnerContact {
    const lastContact = this.last.get(connectionId);
    return {
      state: this.isOnline(connectionId) ? "connected" : "lost",
      lastContactAt:
        lastContact === undefined ? null : new Date(lastContact).toISOString(),
    };
  }
}
