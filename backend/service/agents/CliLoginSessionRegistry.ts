import { AgentError } from "@/backend/error/AgentErrors";
import { isLoginActive } from "@/definition/AgentConnection";
import { logEvent } from "@/backend/logging/Logger";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type {
  CliHome,
  CliRunningProcess,
  CliLoginAdapter,
  CliLoopbackCallback,
} from "@/backend/agents/cli/CliContracts";
import type {
  CliLoginState,
  CliLoginView,
  CliProviderId,
} from "@/definition/AgentConnection";

/** Internal session state is never serialized directly. */
export interface CliLoginSession {
  readonly id: string;
  /** The administrator who started the login; only they see its challenge. */
  readonly ownerId: string;
  readonly provider: CliProviderId;
  readonly adapter: CliLoginAdapter;
  readonly home: CliHome;
  readonly expiresAt: string;
  readonly release: () => void;
  readonly controller: AbortController;
  state: CliLoginState;
  verificationUrl?: string;
  userCode?: string;
  /** Present until a pasted redirect address was handed to the adapter once. */
  loopbackCallback?: CliLoopbackCallback;
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
    logEvent({
      level: "info",
      event: "cli.login.started",
      component: "CliLoginSessionRegistry",
      message: "CLI login session reserved",
      metadata: { sessionId: session.id, provider: session.provider },
    });
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

  /**
   * Describes a login for one viewer.
   *
   * @param id - The connection of the login.
   * @param viewerId - The administrator who reads it.
   * @param includeChallenge - Only the protected polling response sets this.
   * @returns The view, with the temporary challenge only for the login's owner.
   */
  public view(
    id: string,
    viewerId: string,
    includeChallenge = false,
  ): CliLoginView | null {
    const session = this.get(id);
    if (!session) return null;
    const isOwnLogin = session.ownerId === viewerId;
    const view: CliLoginView = {
      state: session.state,
      expiresAt: session.expiresAt,
      errorCode: session.errorCode,
      isOwnLogin,
    };
    if (includeChallenge && isOwnLogin && session.state === "awaiting_user")
      return {
        ...view,
        verificationUrl: session.verificationUrl,
        userCode: session.userCode,
        ...(session.loopbackCallback ? { canSubmitRedirect: true } : {}),
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
    logEvent({
      level: state === "failed" ? "warn" : "info",
      event: "cli.login.completed",
      component: "CliLoginSessionRegistry",
      message: "CLI login session ended",
      metadata: {
        sessionId: session.id,
        provider: session.provider,
        status: state,
        code: errorCode,
      },
    });
    session.errorCode = errorCode;
    session.verificationUrl = undefined;
    session.userCode = undefined;
    session.loopbackCallback = undefined;
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
