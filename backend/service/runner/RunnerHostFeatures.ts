import type { RunnerMessage } from "@/definition/RunnerProtocol";

interface HostFeatures {
  readonly accounts: boolean;
  readonly browser: boolean;
  readonly progress: boolean;
}

/** Retains new host capabilities only for the current reconciled connection. */
export class RunnerHostFeatures {
  private readonly connections = new Map<string, HostFeatures>();

  /** Replaces every capability, including an explicit downgrade that omits it. */
  public remember(
    connectionId: string,
    message: Extract<RunnerMessage, { type: "reconcile" }>,
  ): void {
    this.connections.set(connectionId, {
      accounts: message.agentAccountsVersion === 1,
      browser: message.browserVersion === 1,
      progress: message.progressVersion === 1,
    });
  }

  /** A disconnected or refused connection cannot authorize new contracts. */
  public forget(connectionId: string): void {
    this.connections.delete(connectionId);
  }

  /** Whether independent account homes are announced on the live connection. */
  public supportsAccounts(connectionId: string): boolean {
    return this.connections.get(connectionId)?.accounts === true;
  }

  /** Whether an installed sandboxed browser is announced on the live connection. */
  public supportsBrowser(connectionId: string): boolean {
    return this.connections.get(connectionId)?.browser === true;
  }

  /** Whether structured native progress is announced on the live connection. */
  public supportsProgress(connectionId: string): boolean {
    return this.connections.get(connectionId)?.progress === true;
  }
}
