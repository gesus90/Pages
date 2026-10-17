import { lstat, mkdir, rm } from "node:fs/promises";
import path from "node:path";

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
 * The empty working directory of each Pica conversation.
 *
 * @remarks
 * An agent session continues only in the directory it started in, so every
 * conversation keeps one fixed directory. It stays empty: the session mounts
 * it read-only and has no tool that writes. It lies outside the instance
 * folders, which the isolation hides and refuses as a working directory.
 */
export class PicaAcpWorkspace {
  private readonly root: string;

  /**
   * Creates the directories below one root.
   *
   * @param root - A folder outside the data and agent folders.
   */
  public constructor(root: string) {
    this.root = root;
  }

  /**
   * Returns the directory of a conversation and creates it when needed.
   *
   * @throws {Error} When the root or the directory is a link or not the server account's own.
   */
  public async prepare(sessionId: string): Promise<string> {
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

  /** Removes the directory of a deleted conversation; a missing one is fine. */
  public async remove(sessionId: string): Promise<void> {
    await rm(path.join(this.root, readChatSessionId(sessionId)), {
      recursive: true,
      force: true,
    });
  }
}
