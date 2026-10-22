import { randomUUID } from "node:crypto";

import { RemoteError } from "@/backend/error/RemoteErrors";

import { RemoteConsoleSession } from "./RemoteConsoleSession";

import type { RemoteWorkspaceService } from "./RemoteWorkspaceService";
import type { RemoteConsoleSize } from "@/definition/RemoteConsole";

interface ConsoleEntry {
  readonly ownerId: string;
  readonly workspaceId: string;
  readonly session: RemoteConsoleSession;
  touchedAt: number;
}

const LEASE_MILLISECONDS = 60_000;
const MAXIMUM_PER_USER = 3;
const MAXIMUM_SESSIONS = 50;

/** Keeps console ownership separate from shared SSH connections and expires abandoned shells. */
export class RemoteConsoleService {
  private readonly workspaces: RemoteWorkspaceService;
  private readonly entries = new Map<string, ConsoleEntry>();
  private readonly cleanup: NodeJS.Timeout;

  public constructor(workspaces: RemoteWorkspaceService) {
    this.workspaces = workspaces;
    this.cleanup = setInterval(() => this.expire(), 15_000);
    this.cleanup.unref();
  }

  /** Rechecks access before allocating a shell; the session repeats it before each connect. */
  public async open(
    userId: string,
    workspaceId: string,
    size: RemoteConsoleSize,
  ): Promise<string> {
    await this.workspaces.requireConsole(userId, workspaceId);
    this.expire();
    const own = [...this.entries.values()].filter(
      (entry) => entry.ownerId === userId,
    );
    if (own.length >= MAXIMUM_PER_USER || this.entries.size >= MAXIMUM_SESSIONS)
      throw new RemoteError("remote_blocked");
    const id = randomUUID();
    this.entries.set(id, {
      ownerId: userId,
      workspaceId,
      touchedAt: Date.now(),
      session: new RemoteConsoleSession(
        () => this.workspaces.consoleTarget(userId, workspaceId),
        size,
      ),
    });
    return id;
  }

  /** Checks ownership and current rights for streams, input, geometry and reconnect requests. */
  public async require(
    userId: string,
    workspaceId: string,
    id: string,
  ): Promise<RemoteConsoleSession> {
    const entry = this.owned(userId, workspaceId, id);
    try {
      await this.workspaces.requireConsole(userId, workspaceId);
    } catch (error: unknown) {
      entry.session.close("remote.error.remote_access_denied");
      throw error;
    }
    entry.touchedAt = Date.now();
    return entry.session;
  }

  /** The owner can always release a shell, including after access has been revoked. */
  public close(userId: string, workspaceId: string, id: string): void {
    const entry = this.owned(userId, workspaceId, id);
    entry.session.close();
    this.entries.delete(id);
  }

  /** Ends all shells before SSH masters and the database stop. */
  public shutdown(): void {
    clearInterval(this.cleanup);
    for (const entry of this.entries.values()) entry.session.close();
    this.entries.clear();
  }

  private owned(userId: string, workspaceId: string, id: string): ConsoleEntry {
    const entry = this.entries.get(id);
    if (!entry || entry.ownerId !== userId || entry.workspaceId !== workspaceId)
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
