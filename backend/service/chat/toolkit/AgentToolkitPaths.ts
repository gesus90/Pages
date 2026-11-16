import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { containsAgentBrowserSecret } from "@/backend/security/AgentBrowserSecrets";

/** Why a path of the agent was refused. */
export type AgentToolkitPathErrorCode = "PROTECTED_PATH" | "INVALID_PATH";

/** A path the agent named lies in a protected folder or is malformed. */
export class AgentToolkitPathError extends Error {
  public readonly code: AgentToolkitPathErrorCode;

  public constructor(code: AgentToolkitPathErrorCode) {
    super(`Agent toolkit path refused: ${code}`);
    this.name = "AgentToolkitPathError";
    this.code = code;
  }
}

/** Whether `candidate` is `root` itself or lies below it. */
export function isInsideRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

/** The real path of the nearest part of `candidate` that exists. */
async function nearestExisting(candidate: string): Promise<string> {
  let current = candidate;
  for (;;) {
    try {
      await lstat(current);
      return await realpath(current);
    } catch (error: unknown) {
      if (!isMissing(error)) throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

async function realDirectories(
  directories: readonly string[],
): Promise<readonly string[]> {
  return await Promise.all(
    directories.map((directory) =>
      realpath(directory).catch(() => path.resolve(directory)),
    ),
  );
}

/**
 * Resolves a path the agent names on the host.
 * @param root - The working folder of the session, where a relative path starts.
 * @param requested - A path relative to the root, or an absolute path anywhere.
 * @param protectedDirectories - Folders no file tool may reach, also through
 * a link: in "Lesend" the instance folders of Pages; none in YOLO.
 * @returns The absolute path.
 * @throws {AgentToolkitPathError} `PROTECTED_PATH` for a path of a protected
 * folder or of the browser's secret store; `INVALID_PATH` for a NUL
 * character.
 * @remarks
 * The working folder is where a session starts, not a boundary: absolute
 * paths, other repositories, the home folder and links that point out of
 * the working folder work as far as the account's Linux rights allow. A
 * path that does not exist yet is checked through its nearest existing
 * parent, so a file can be created, but never below a link into a protected
 * folder.
 */
export async function resolveToolkitPath(
  root: string,
  requested: string,
  protectedDirectories: readonly string[] = [],
): Promise<string> {
  if (requested.includes("\0")) throw new AgentToolkitPathError("INVALID_PATH");
  const realRoot = await realpath(root);
  const candidate = path.resolve(realRoot, requested === "" ? "." : requested);
  if (containsAgentBrowserSecret(candidate))
    throw new AgentToolkitPathError("PROTECTED_PATH");
  const existing = await nearestExisting(candidate);
  if (containsAgentBrowserSecret(existing))
    throw new AgentToolkitPathError("PROTECTED_PATH");
  // The working folder itself may lie in a protected folder, such as the folder of a chat.
  if (isInsideRoot(realRoot, candidate) && isInsideRoot(realRoot, existing))
    return candidate;
  const protectedRoots = await realDirectories(protectedDirectories);
  if (
    protectedRoots.some(
      (directory) =>
        isInsideRoot(directory, candidate) || isInsideRoot(directory, existing),
    )
  )
    throw new AgentToolkitPathError("PROTECTED_PATH");
  return candidate;
}

/** The path as the agent sees it: relative inside the working folder, absolute outside. */
export function relativeToolkitPath(root: string, absolute: string): string {
  if (!isInsideRoot(root, absolute)) return absolute;
  return path.relative(root, absolute) || ".";
}
