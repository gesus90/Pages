import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";

import { logCaughtError } from "@/backend/logging/Logger";

import { readChatSessionId } from "../ChatSessionService";

/** The name of the folder of Pica's working directories, next to the agent folders. */
export const PICA_WORKSPACE_DIRECTORY_NAME = "pica-sessions";

async function requireOwnDirectory(directory: string): Promise<void> {
  const facts = await lstat(directory);
  const owner = process.getuid?.();
  if (
    facts.isSymbolicLink() ||
    !facts.isDirectory() ||
    (owner !== undefined && facts.uid !== owner)
  )
    throw new Error("A Pica working directory is not a private directory.");
}

/**
 * The private working directory of each Pica conversation.
 *
 * @remarks
 * An agent session continues only in the directory it started in, so every
 * conversation keeps one fixed directory. The session mounts it read-only.
 * Job reservations protect it through answer-file transfer. Once the last job
 * closes, its contents are removed; a later job recreates the same path. It lies outside the instance
 * folders, which the isolation hides and refuses as a working directory.
 */
export class PicaAcpWorkspace {
  private readonly root: string;
  private readonly pending = new Map<string, number>();
  private readonly queue = new SerialQueue();

  /**
   * Creates the directories below one root.
   *
   * @param root - A folder outside the data and agent folders.
   */
  public constructor(root: string) {
    this.root = root;
  }

  /** Reserves a running or waiting job synchronously; releasing the last reservation removes its workspace. */
  public reserve(sessionId: string): () => Promise<void> {
    const id = readChatSessionId(sessionId);
    this.pending.set(id, (this.pending.get(id) ?? 0) + 1);
    let isReleased = false;
    return async () => {
      if (isReleased) return;
      isReleased = true;
      const remaining = (this.pending.get(id) ?? 1) - 1;
      if (remaining > 0) this.pending.set(id, remaining);
      else this.pending.delete(id);
      await this.queue.run(async () => {
        if (!this.pending.has(id)) await this.remove(id);
      });
    };
  }

  /** Removes abandoned workspaces after a crash; reservations exclude running and queued jobs. */
  public async sweep(): Promise<void> {
    await this.queue.run(async () => {
      const root = await lstat(this.root).catch((error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return null;
        throw error;
      });
      if (!root) return;
      await requireOwnDirectory(this.root);
      for (const entry of await readdir(this.root, { withFileTypes: true })) {
        if (this.pending.has(entry.name) || !entry.isDirectory()) continue;
        await rm(path.join(this.root, entry.name), {
          recursive: true,
          force: true,
        });
      }
    });
  }

  /**
   * Returns the directory of a conversation and creates it when needed.
   *
   * @throws {Error} When the root or the directory is a link or not the server account's own.
   */
  public prepare(sessionId: string): Promise<string> {
    return this.queue.run(() => this.prepareDirectory(sessionId));
  }

  /** Removes the directory of a deleted conversation; a missing one is fine. */
  public async remove(sessionId: string): Promise<void> {
    await rm(path.join(this.root, readChatSessionId(sessionId)), {
      recursive: true,
      force: true,
    });
  }

  private async prepareDirectory(sessionId: string): Promise<string> {
    const directory = path.join(this.root, readChatSessionId(sessionId));
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await requireOwnDirectory(this.root);
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error: unknown) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      )) {
        logCaughtError("PicaAcpWorkspace", error);
        throw error;
      }
    }
    await requireOwnDirectory(directory);
    return directory;
  }
}
