import { PicaAcpJobError } from "@/backend/error/PicaAcpJobError";

/**
 * Waits for the Codex thread to leave the state of a running turn.
 *
 * @remarks
 * codex-acp 2.2.2 reports no end of a turn it started itself for a steer; it
 * forwards the Codex thread status instead, and a turn ended when an active
 * thread is no longer active.
 */
export class PicaAcpThreadWatch {
  private hasBeenActive = false;
  private hasEnded = false;
  private isClosed = false;
  private waiter: {
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
  } | null = null;

  /**
   * Forgets what came before; activity from now on belongs to a turn of the
   * adapter. Called when a prompt of the current session ended, so an earlier,
   * replaced session no longer counts as closed.
   */
  public reset(): void {
    this.hasBeenActive = false;
    this.hasEnded = false;
    this.isClosed = false;
  }

  /** Receives a thread status of the adapter. */
  public observe(isActive: boolean): void {
    if (isActive) {
      this.hasBeenActive = true;
      return;
    }
    if (!this.hasBeenActive) return;
    this.hasEnded = true;
    this.waiter?.resolve();
  }

  /** The adapter is gone; a turn of it can no longer end. */
  public close(): void {
    this.isClosed = true;
    this.waiter?.reject(new PicaAcpJobError("providerFailed"));
  }

  /** Resolves once a turn began and ended after the last reset. */
  public async ended(signal: AbortSignal): Promise<void> {
    if (this.hasEnded) return;
    if (this.isClosed) throw new PicaAcpJobError("providerFailed");
    const abort = (): void =>
      this.waiter?.reject(new PicaAcpJobError("cancelled"));
    try {
      await new Promise<void>((resolve, reject) => {
        this.waiter = { resolve, reject };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    } finally {
      signal.removeEventListener("abort", abort);
      this.waiter = null;
    }
  }
}
