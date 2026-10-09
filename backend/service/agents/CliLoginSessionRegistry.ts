import { AgentError } from "@/backend/error/AgentErrors";
import { isLoginActive } from "@/definition/AgentConnection";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type {
  CliHome,
  CliRunningProcess,
  CliToolAdapter,
} from "@/backend/agents/cli/CliContracts";
import type {
  CliLoginState,
  CliLoginView,
  CliProviderId,
} from "@/definition/AgentConnection";

/** Internal session state is never serialized directly. */
export interface CliLoginSession {
  readonly id: string;
  readonly provider: CliProviderId;
  readonly adapter: CliToolAdapter;
  readonly home: CliHome;
  readonly expiresAt: string;
  readonly release: () => void;
  readonly controller: AbortController;
  state: CliLoginState;
  verificationUrl?: string;
  userCode?: string;
  errorCode?: AgentErrorCode;
  process: CliRunningProcess | null;
  task: Promise<void> | null;
  expiry: ReturnType<typeof setTimeout> | null;
}

/** Stores up to three active logins and retains terminal states for five minutes. */
export class CliLoginSessionRegistry {
  private readonly sessions = new Map<string, CliLoginSession>();
  private readonly retention = new Map<string, ReturnType<typeof setTimeout>>();

  /** Reserves the session synchronously, including time spent preparing its process. */
  public add(session: CliLoginSession): void {
    if (this.active().length >= 3) throw new AgentError("login_limit_reached");
    this.forget(session.id);
    this.sessions.set(session.id, session);
  }

  /** Finds the current session without restoring an incomplete login after restart. */
  public get(id: string): CliLoginSession | null {
    return this.sessions.get(id) ?? null;
  }

  /** Enumerates active sessions for cancellation and shutdown. */
  public active(): CliLoginSession[] {
    return [...this.sessions.values()].filter((session) =>
      isLoginActive(session.state),
    );
  }

  /** Only a protected polling response may request the temporary challenge. */
  public view(id: string, includeChallenge = false): CliLoginView | null {
    const session = this.get(id);
    if (!session) return null;
    const view: CliLoginView = {
      state: session.state,
      expiresAt: session.expiresAt,
      errorCode: session.errorCode,
    };
    if (includeChallenge && session.state === "awaiting_user")
      return {
        ...view,
        verificationUrl: session.verificationUrl,
        userCode: session.userCode,
      };
    return view;
  }

  /** Drops challenge data immediately and releases the shared connection lock. */
  public finish(
    session: CliLoginSession,
    state: "succeeded" | "failed" | "expired" | "cancelled",
    errorCode?: AgentErrorCode,
  ): void {
    if (!isLoginActive(session.state)) return;
    session.state = state;
    session.errorCode = errorCode;
    session.verificationUrl = undefined;
    session.userCode = undefined;
    session.process = null;
    if (session.expiry) clearTimeout(session.expiry);
    session.expiry = null;
    session.release();
    const timeout = setTimeout(() => this.forget(session.id), 300_000);
    timeout.unref();
    this.retention.set(session.id, timeout);
  }

  /** Removes only in-memory session metadata, never a credential file. */
  public forget(id: string): void {
    const timeout = this.retention.get(id);
    if (timeout) clearTimeout(timeout);
    this.retention.delete(id);
    this.sessions.delete(id);
  }

  /** Releases all retention timers after active work has drained. */
  public clear(): void {
    for (const id of this.sessions.keys()) this.forget(id);
  }
}
