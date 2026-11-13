import { createHash, randomBytes } from "node:crypto";

import { browserSessionCookie } from "@/backend/auth/BrowserSessionCookie";
import { hasHostTools } from "@/definition/AgentEmployee";

import { PicaAdminError } from "../admin/PicaAdminContracts";
import { adminScope } from "../admin/PicaAdminFiles";
import { AgentBrowserRuntimeFiles } from "./AgentBrowserRuntimeFiles";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type { User } from "@/definition/User";
import type { PicaBrowserStorageState } from "./PicaBrowserSession";

const MAXIMUM_AGE_MS = 8 * 60 * 60_000;

/** Fresh account and access facts; no password or administrator credential is read. */
export interface AgentBrowserAccounts {
  readonly user: (id: string) => Promise<User | null>;
  readonly employee: (id: string) => Promise<{
    readonly access: AgentEmployeeAccess;
    readonly revision: number;
  } | null>;
  readonly origins: () => readonly string[];
}

/** Server-owned lease; the state is only passed to Playwright, never to tool results. */
export interface AgentBrowserLease {
  readonly context: RuntimeExecutionContext;
  readonly storage: PicaBrowserStorageState;
  readonly file: string;
  readonly ownerName: string;
}

interface IssuedSession {
  readonly scope: string;
  readonly userId: string;
  readonly access: AgentEmployeeAccess;
  readonly revision: number;
  readonly expires: number;
  readonly controller: AbortController;
  readonly context: RuntimeExecutionContext;
  readonly lease: AgentBrowserLease;
  readonly detach: () => void;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Issues job-bound sessions of an agent's own account and revokes them on every invalidation. */
export class AgentBrowserSessions {
  private readonly accounts: AgentBrowserAccounts;
  private readonly files: AgentBrowserRuntimeFiles;
  private readonly sessions = new Map<string, IssuedSession>();
  private readonly removals = new Map<
    string,
    { readonly scope: string; readonly completion: Promise<void> }
  >();

  /** Connects fresh account facts to private runtime files. */
  public constructor(
    accounts: AgentBrowserAccounts,
    files: AgentBrowserRuntimeFiles = new AgentBrowserRuntimeFiles(),
  ) {
    this.accounts = accounts;
    this.files = files;
  }

  /** Issues at most one private session per job, and never one for "Nur Pages". */
  public async issue(
    context: RuntimeExecutionContext,
  ): Promise<AgentBrowserLease> {
    await context.authorize();
    context.signal.throwIfAborted();
    const existing = [...this.sessions.values()].find(
      (entry) => entry.scope === adminScope(context),
    );
    if (existing) return existing.lease;
    const [user, employee] = await Promise.all([
      this.accounts.user(context.userId),
      this.accounts.employee(context.userId),
    ]);
    if (!this.isEligible(user) || !employee || !hasHostTools(employee.access))
      throw new PicaAdminError("SESSION_DENIED");
    const token = `pabs_${randomBytes(32).toString("base64url")}`;
    const tokenHash = hashToken(token);
    const expires = Date.now() + MAXIMUM_AGE_MS;
    const controller = new AbortController();
    const bound: RuntimeExecutionContext = {
      ...context,
      signal: AbortSignal.any([context.signal, controller.signal]),
      authorize: async () => {
        if (!(await this.authenticate(token)))
          throw new PicaAdminError("SESSION_DENIED");
      },
    };
    const storage = await this.storage(token, expires);
    const file = await this.files.write(
      JSON.stringify([context.userId, context.sessionId]),
      storage,
    );
    const lease = {
      context: bound,
      storage,
      file,
      ownerName: user.displayName,
    };
    const abort = (): void => {
      void this.revoke(token).catch(() => controller.abort("cleanupFailed"));
    };
    const timer = setTimeout(abort, MAXIMUM_AGE_MS);
    timer.unref();
    this.sessions.set(tokenHash, {
      scope: adminScope(context),
      userId: user.id,
      ...employee,
      expires,
      controller,
      context,
      lease,
      detach: () => {
        clearTimeout(timer);
        context.signal.removeEventListener("abort", abort);
      },
    });
    context.signal.addEventListener("abort", abort, { once: true });
    if (context.signal.aborted) {
      await this.revoke(token);
      context.signal.throwIfAborted();
    }
    return lease;
  }

  /** Authenticates every request with current account/access facts; expired or changed jobs fail closed. */
  public async authenticate(token: string): Promise<User | null> {
    const entry = this.sessions.get(hashToken(token));
    if (!entry) return null;
    try {
      const [user, employee] = await Promise.all([
        this.accounts.user(entry.userId),
        this.accounts.employee(entry.userId),
      ]);
      if (
        !this.isEligible(user) ||
        !employee ||
        employee.access !== entry.access ||
        employee.revision !== entry.revision ||
        entry.expires <= Date.now() ||
        entry.context.signal.aborted ||
        entry.controller.signal.aborted
      ) {
        await this.revoke(token);
        return null;
      }
      await entry.context.authorize();
      if (
        this.sessions.get(hashToken(token)) !== entry ||
        entry.controller.signal.aborted ||
        entry.expires <= Date.now()
      )
        return null;
      return user;
    } catch {
      await this.revoke(token);
      return null;
    }
  }

  /** Revokes a browser credential before removing its private file. */
  public async revoke(token: string): Promise<void> {
    await this.remove(hashToken(token));
  }

  /** Ends every issued credential and browser of a job, including after failures. */
  public async release(scope: string): Promise<void> {
    const keys = [...this.sessions]
      .filter(([, entry]) => entry.scope === scope)
      .map(([key]) => key);
    await Promise.all(keys.map((key) => this.remove(key)));
    await Promise.all(
      [...this.removals.values()]
        .filter((entry) => entry.scope === scope)
        .map((entry) => entry.completion),
    );
  }

  /** Revokes all remaining leases and removes the private runtime mounts on shutdown. */
  public async close(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((key) => this.remove(key)));
    await Promise.all(
      [...this.removals.values()].map((entry) => entry.completion),
    );
    await this.files.close();
  }

  private isEligible(user: User | null): user is User {
    return (
      user !== null &&
      user.isActive &&
      user.isAgent === true &&
      !user.mustChangePassword &&
      user.role !== "admin"
    );
  }

  private async remove(key: string): Promise<void> {
    const pending = this.removals.get(key);
    if (pending) return pending.completion;
    const entry = this.sessions.get(key);
    if (!entry) return;
    this.sessions.delete(key);
    entry.detach();
    entry.controller.abort("browserSessionRevoked");
    const completion = this.files.remove(entry.lease.file);
    this.removals.set(key, { scope: entry.scope, completion });
    try {
      await completion;
    } finally {
      this.removals.delete(key);
    }
  }

  private async storage(
    token: string,
    expires: number,
  ): Promise<PicaBrowserStorageState> {
    const header = await browserSessionCookie.serialize(token);
    const encoded = header.slice(header.indexOf("=") + 1).split(";")[0];
    return {
      cookies: this.accounts.origins().map((origin) => {
        const url = new URL(origin);
        return {
          name: "pages_session",
          value: decodeURIComponent(encoded),
          domain: url.hostname,
          path: "/",
          expires: Math.floor(expires / 1000),
          httpOnly: true,
          secure: url.protocol === "https:",
          sameSite: "Lax" as const,
        };
      }),
      origins: [],
    };
  }
}
