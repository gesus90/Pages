import { randomUUID } from "node:crypto";

import { RemoteError } from "@/backend/error/RemoteErrors";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { CONSOLE_MAXIMUM_RETRIES } from "@/definition/RemoteConsole";

import { RemoteConsoleSession, consoleMessageOf } from "./RemoteConsoleSession";

import type {
  RemoteConsoleSessionRepository,
  StoredConsoleSession,
} from "@/backend/database/repositories/remote/RemoteConsoleSessionRepository";
import type { RemoteConnectionService } from "./RemoteConnectionService";
import type { RemoteConsoleTarget } from "./RemoteConsoleSession";
import type { RemoteWorkspaceService } from "./RemoteWorkspaceService";
import type { RemoteConsoleSize } from "@/definition/RemoteConsole";

/**
 * What a console is opened for: a registered workspace, whose shell starts in
 * its directory, a whole connection, whose shell starts in the login directory,
 * or the guided runner setup of a connection, which runs its script instead.
 */
export interface RemoteConsoleScope {
  readonly kind: "workspace" | "connection" | "setup";
  readonly id: string;
}

/** What the request that opens a console says about where Pages is reached from. */
export interface RemoteConsoleOpenContext {
  /** The same-origin `Origin` of the request, `null` when unknown. */
  readonly origin: string | null;
}

/** The rules of the guided setup console; the setup service answers them. */
export interface RemoteConsoleSetupAccess {
  /** Rights that must hold for as long as the run exists. */
  requireAccess(userId: string, connectionId: string): Promise<void>;
  /** Conditions of a start: nothing confirmed installed and no registration yet. */
  requireStart(userId: string, connectionId: string): Promise<void>;
  /** The target whose conductor prepares, starts and verifies the setup. */
  target(
    userId: string,
    connectionId: string,
    context: RemoteConsoleOpenContext,
  ): Promise<RemoteConsoleTarget>;
}

/** The services that decide, before every shell, who may open it and where it starts. */
export interface RemoteConsoleDependencies {
  readonly workspaces: Pick<
    RemoteWorkspaceService,
    "requireConsole" | "consoleTarget"
  >;
  readonly connections: Pick<
    RemoteConnectionService,
    "requireConsole" | "consoleTarget"
  >;
  /**
   * Keeps console identities across an API restart (PAGE-239); without it a
   * console ends with the process, as before.
   */
  readonly store?: Pick<
    RemoteConsoleSessionRepository,
    "save" | "find" | "remove" | "removeExpired"
  >;
}

interface ConsoleEntry {
  readonly ownerId: string;
  readonly scope: RemoteConsoleScope;
  readonly session: RemoteConsoleSession;
  touchedAt: number;
  storedAt: number;
}

const LEASE_MILLISECONDS = 60_000;
/** A touched console is stored again at most this often. */
const STORE_INTERVAL_MILLISECONDS = 15_000;
/**
 * The stored lease covers the in-memory lease plus one store interval, so a
 * console is restorable for at least a minute after the API went away.
 */
const STORED_LEASE_SECONDS =
  (LEASE_MILLISECONDS + STORE_INTERVAL_MILLISECONDS * 2) / 1000;
const MAXIMUM_PER_USER = 3;
const MAXIMUM_SESSIONS = 50;

/**
 * Keeps console ownership separate from shared SSH connections and expires abandoned shells.
 *
 * @remarks
 * With a store, the identity of a workspace or connection console outlives
 * the API process (PAGE-239): owner, target, geometry, attempt and last event
 * number, for the console's lease. After a restart the unchanged browser
 * reattaches with the same console id; the API restores it only for the same
 * signed-in owner and target, after checking the owner's rights anew, and
 * starts a fresh shell that begins with a gap. Output, input and side effects
 * of the lost shell are never replayed, and a guided setup is never stored.
 */
export class RemoteConsoleService {
  private readonly dependencies: RemoteConsoleDependencies;
  private readonly entries = new Map<string, ConsoleEntry>();
  private readonly restoring = new Map<string, Promise<ConsoleEntry>>();
  private readonly cleanup: NodeJS.Timeout;
  private setup: RemoteConsoleSetupAccess | null = null;
  private isStopping = false;

  public constructor(dependencies: RemoteConsoleDependencies) {
    this.dependencies = dependencies;
    this.cleanup = setInterval(() => this.expire(), 15_000);
    this.cleanup.unref();
  }

  /** Connects the setup rules, which exist only after the runner services are built. */
  public attachSetup(setup: RemoteConsoleSetupAccess): void {
    this.setup = setup;
  }

  /**
   * Whether a setup run holds the connection; it ends with its console.
   *
   * @param connectionId - The connection.
   * @returns Whether a setup console of any person is open and not ended.
   */
  public hasSetup(connectionId: string): boolean {
    return [...this.entries.values()].some(
      (entry) =>
        entry.scope.kind === "setup" &&
        entry.scope.id === connectionId &&
        entry.session.view().status !== "ended",
    );
  }

  /**
   * Rechecks access before allocating a shell; the session repeats it before each connect.
   *
   * @remarks
   * A setup holds its connection exclusively: the check for a running setup
   * and the new entry follow each other without any waiting in between, so
   * two requests cannot both start.
   */
  public async open(
    userId: string,
    scope: RemoteConsoleScope,
    size: RemoteConsoleSize,
    context: RemoteConsoleOpenContext = { origin: null },
  ): Promise<string> {
    await this.requireAccess(userId, scope);
    if (scope.kind === "setup")
      await this.requireSetup().requireStart(userId, scope.id);
    this.expire();
    this.requireCapacity(userId);
    if (scope.kind === "setup" && this.hasSetup(scope.id))
      throw new RemoteError("remote_setup_running");
    const id = randomUUID();
    const session = new RemoteConsoleSession(
      () => this.target(userId, scope, context),
      size,
    );
    await this.track(id, { ownerId: userId, scope, session });
    return id;
  }

  /** Checks ownership and current rights for streams, input, geometry and reconnect requests. */
  public async require(
    userId: string,
    scope: RemoteConsoleScope,
    id: string,
  ): Promise<RemoteConsoleSession> {
    const entry = this.entries.has(id)
      ? this.owned(userId, scope, id)
      : await this.restoreOnce(userId, scope, id);
    try {
      await this.requireAccess(userId, scope);
    } catch (error: unknown) {
      entry.session.close(consoleMessageOf(error));
      void this.forget(id);
      throw error;
    }
    entry.touchedAt = Date.now();
    if (entry.touchedAt - entry.storedAt >= STORE_INTERVAL_MILLISECONDS)
      void this.store(id, entry);
    return entry.session;
  }

  /** The owner can always release a shell, including after access has been revoked. */
  public close(userId: string, scope: RemoteConsoleScope, id: string): void {
    // A console held only in the store, such as after a restart, is released too.
    if (!this.entries.has(id)) void this.forgetOwned(userId, scope, id);
    const entry = this.owned(userId, scope, id);
    entry.session.close();
    this.entries.delete(id);
    void this.forget(id);
  }

  /**
   * Ends all shells before SSH masters and the database stop.
   *
   * @remarks
   * Stored identities stay, so the browsers reattach to fresh shells once
   * the API runs again.
   */
  public shutdown(): void {
    this.isStopping = true;
    clearInterval(this.cleanup);
    for (const entry of this.entries.values()) entry.session.close();
    this.entries.clear();
  }

  private requireCapacity(userId: string): void {
    const own = [...this.entries.values()].filter(
      (entry) => entry.ownerId === userId,
    );
    if (own.length >= MAXIMUM_PER_USER || this.entries.size >= MAXIMUM_SESSIONS)
      throw new RemoteError("remote_blocked");
  }

  /** Holds a console and stores its identity; a guided setup is held only. */
  private async track(
    id: string,
    held: Omit<ConsoleEntry, "touchedAt" | "storedAt">,
  ): Promise<ConsoleEntry> {
    const entry: ConsoleEntry = {
      ...held,
      touchedAt: Date.now(),
      storedAt: 0,
    };
    this.entries.set(id, entry);
    // An ended shell, such as after `exit`, is never restored; a stop is no end.
    held.session.follow(0, (event) => {
      if (
        event.kind === "state" &&
        event.state.status === "ended" &&
        !this.isStopping
      )
        void this.forget(id);
    });
    await this.store(id, entry);
    return entry;
  }

  private async store(id: string, entry: ConsoleEntry): Promise<void> {
    const store = this.dependencies.store;
    if (!store || entry.scope.kind === "setup") return;
    if (entry.session.view().status === "ended") return;
    entry.storedAt = Date.now();
    const { lastSequence, size } = entry.session.progress();
    try {
      await store.save(
        {
          id,
          ownerId: entry.ownerId,
          scopeKind: entry.scope.kind,
          scopeId: entry.scope.id,
          columns: size.columns,
          rows: size.rows,
          attempts: entry.session.view().attempts,
          lastSequence,
        },
        STORED_LEASE_SECONDS,
      );
    } catch (error: unknown) {
      // The console keeps working; only a restore after an API restart is lost.
      logCaughtError("RemoteConsoleService", error);
    }
  }

  private async forget(id: string): Promise<void> {
    try {
      await this.dependencies.store?.remove(id);
    } catch (error: unknown) {
      logCaughtError("RemoteConsoleService", error);
    }
  }

  private async forgetOwned(
    userId: string,
    scope: RemoteConsoleScope,
    id: string,
  ): Promise<void> {
    try {
      const stored = await this.dependencies.store?.find(id);
      if (stored && isOwnedBy(stored, userId, scope)) await this.forget(id);
    } catch (error: unknown) {
      logCaughtError("RemoteConsoleService", error);
    }
  }

  /** Concurrent requests for the same console share one restore. */
  private restoreOnce(
    userId: string,
    scope: RemoteConsoleScope,
    id: string,
  ): Promise<ConsoleEntry> {
    const pending = this.restoring.get(id);
    if (pending) return pending.then(() => this.owned(userId, scope, id));
    const restore = this.restore(userId, scope, id).finally(() =>
      this.restoring.delete(id),
    );
    this.restoring.set(id, restore);
    return restore;
  }

  /**
   * Restores a console whose shell ended with the previous API process.
   *
   * @remarks
   * Only the same owner and target qualify, within the lease and the
   * attempt budget, and only after the owner's rights were checked again;
   * otherwise the console counts as unknown, as before. The fresh shell is
   * resolved with the current rights as well.
   */
  private async restore(
    userId: string,
    scope: RemoteConsoleScope,
    id: string,
  ): Promise<ConsoleEntry> {
    const stored =
      scope.kind === "setup" || !this.dependencies.store
        ? null
        : await this.dependencies.store.find(id);
    if (!stored || !isRestorable(stored, userId, scope))
      throw new RemoteError("remote_workspace_not_found");
    try {
      await this.requireAccess(userId, scope);
    } catch (error: unknown) {
      await this.forget(id);
      throw error;
    }
    if (this.entries.has(id)) return this.owned(userId, scope, id);
    this.requireCapacity(userId);
    const session = new RemoteConsoleSession(
      () => this.target(userId, scope, { origin: null }),
      { columns: stored.columns, rows: stored.rows },
      { lastSequence: stored.lastSequence, attempts: stored.attempts + 1 },
    );
    logEvent({
      level: "info",
      event: "remote.console.restored",
      component: "RemoteConsoleService",
      message: "A console was restored with a fresh shell after an API restart",
      metadata: { kind: scope.kind, attempt: stored.attempts + 1 },
    });
    return this.track(id, { ownerId: userId, scope, session });
  }

  private requireSetup(): RemoteConsoleSetupAccess {
    if (!this.setup) throw new RemoteError("remote_access_denied");
    return this.setup;
  }

  private async requireAccess(
    userId: string,
    scope: RemoteConsoleScope,
  ): Promise<void> {
    if (scope.kind === "workspace")
      await this.dependencies.workspaces.requireConsole(userId, scope.id);
    else if (scope.kind === "setup")
      await this.requireSetup().requireAccess(userId, scope.id);
    else await this.dependencies.connections.requireConsole(userId, scope.id);
  }

  private async target(
    userId: string,
    scope: RemoteConsoleScope,
    context: RemoteConsoleOpenContext,
  ): Promise<RemoteConsoleTarget> {
    if (scope.kind === "workspace")
      return this.dependencies.workspaces.consoleTarget(userId, scope.id);
    if (scope.kind === "setup")
      return this.requireSetup().target(userId, scope.id, context);
    return this.dependencies.connections.consoleTarget(userId, scope.id);
  }

  private owned(
    userId: string,
    scope: RemoteConsoleScope,
    id: string,
  ): ConsoleEntry {
    const entry = this.entries.get(id);
    if (
      !entry ||
      entry.ownerId !== userId ||
      entry.scope.kind !== scope.kind ||
      entry.scope.id !== scope.id
    )
      throw new RemoteError("remote_workspace_not_found");
    return entry;
  }

  private expire(): void {
    const cutoff = Date.now() - LEASE_MILLISECONDS;
    for (const [id, entry] of this.entries) {
      if (entry.touchedAt >= cutoff) continue;
      entry.session.close();
      this.entries.delete(id);
      void this.forget(id);
    }
    void this.dependencies.store?.removeExpired().catch((error: unknown) => {
      logCaughtError("RemoteConsoleService", error);
    });
  }
}

/** The same owner and target; a setup is never stored. */
function isOwnedBy(
  stored: StoredConsoleSession,
  userId: string,
  scope: RemoteConsoleScope,
): boolean {
  return (
    stored.ownerId === userId &&
    stored.scopeKind === scope.kind &&
    stored.scopeId === scope.id
  );
}

/** Owned, and with a shell attempt left in the budget. */
function isRestorable(
  stored: StoredConsoleSession,
  userId: string,
  scope: RemoteConsoleScope,
): boolean {
  return (
    isOwnedBy(stored, userId, scope) &&
    stored.attempts < CONSOLE_MAXIMUM_RETRIES
  );
}
