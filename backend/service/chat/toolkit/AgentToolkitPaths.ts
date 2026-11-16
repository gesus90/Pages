import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { containsAgentBrowserSecret } from "@/backend/security/AgentBrowserSecrets";

/** Why a path of the agent was refused. */
export type AgentToolkitPathErrorCode = "OUTSIDE_WORKSPACE" | "INVALID_PATH";

/** A path the agent named lies outside its allowed roots or is malformed. */
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

/**
 * Resolves a path the agent names inside its working folder.
 *
 * @param root - The working folder of the session: the agent's assigned
 * workspace or the folder of the chat session.
 * @param requested - A path relative to the root, or an absolute path inside it.
 * @returns The absolute path, below the real root.
 * @throws {AgentToolkitPathError} `OUTSIDE_WORKSPACE` for a path that leaves
 * the root, also through `..` or a symbolic link, and for a path of the
 * browser's secret store; `INVALID_PATH` for an empty path or a NUL character.
 *
 * @remarks
 * A path that does not exist yet is checked through its nearest existing
 * parent, so a file can be created, but never below a link that points out.
 */
export async function resolveToolkitPath(
  root: string,
  requested: string,
): Promise<string> {
  if (requested.includes("\0")) throw new AgentToolkitPathError("INVALID_PATH");
  const realRoot = await realpath(root);
  const candidate = path.resolve(realRoot, requested === "" ? "." : requested);
  if (
    !isInsideRoot(realRoot, candidate) ||
    containsAgentBrowserSecret(candidate)
  )
    throw new AgentToolkitPathError("OUTSIDE_WORKSPACE");
  const existing = await nearestExisting(candidate);
  if (!isInsideRoot(realRoot, existing))
    throw new AgentToolkitPathError("OUTSIDE_WORKSPACE");
  return candidate;
}

/** The path relative to the root, as the agent sees it. */
export function relativeToolkitPath(root: string, absolute: string): string {
  return path.relative(root, absolute) || ".";
}
