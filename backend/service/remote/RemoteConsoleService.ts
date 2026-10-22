import { randomUUID } from "node:crypto";

import { RemoteError } from "@/backend/error/RemoteErrors";

import { RemoteConsoleSession, consoleMessageOf } from "./RemoteConsoleSession";

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
}

interface ConsoleEntry {
  readonly ownerId: string;
  readonly scope: RemoteConsoleScope;
  readonly session: RemoteConsoleSession;
  touchedAt: number;
}

const LEASE_MILLISECONDS = 60_000;
const MAXIMUM_PER_USER = 3;
const MAXIMUM_SESSIONS = 50;

/** Keeps console ownership separate from shared SSH connections and expires abandoned shells. */
export class RemoteConsoleService {
  private readonly dependencies: RemoteConsoleDependencies;
  private readonly entries = new Map<string, ConsoleEntry>();
  private readonly cleanup: NodeJS.Timeout;
  private setup: RemoteConsoleSetupAccess | null = null;

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
    const own = [...this.entries.values()].filter(
      (entry) => entry.ownerId === userId,
    );
    if (own.length >= MAXIMUM_PER_USER || this.entries.size >= MAXIMUM_SESSIONS)
      throw new RemoteError("remote_blocked");
    if (scope.kind === "setup" && this.hasSetup(scope.id))
      throw new RemoteError("remote_setup_running");
    const id = randomUUID();
    this.entries.set(id, {
      ownerId: userId,
      scope,
      touchedAt: Date.now(),
      session: new RemoteConsoleSession(
        () => this.target(userId, scope, context),
        size,
      ),
    });
    return id;
  }

  /** Checks ownership and current rights for streams, input, geometry and reconnect requests. */
  public async require(
    userId: string,
    scope: RemoteConsoleScope,
    id: string,
  ): Promise<RemoteConsoleSession> {
    const entry = this.owned(userId, scope, id);
    try {
      await this.requireAccess(userId, scope);
    } catch (error: unknown) {
      entry.session.close(consoleMessageOf(error));
      throw error;
    }
    entry.touchedAt = Date.now();
    return entry.session;
  }

  /** The owner can always release a shell, including after access has been revoked. */
  public close(userId: string, scope: RemoteConsoleScope, id: string): void {
    const entry = this.owned(userId, scope, id);
    entry.session.close();
    this.entries.delete(id);
  }

  /** Ends all shells before SSH masters and the database stop. */
  public shutdown(): void {
    clearInterval(this.cleanup);
    for (const entry of this.entries.values()) entry.session.close();
    this.entries.clear();
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
    }
  }
}
