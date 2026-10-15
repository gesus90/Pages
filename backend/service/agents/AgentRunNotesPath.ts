import { lstat, mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";

import { containsWorkspacePath } from "./AgentWorkspacePath";

/** The controlled, non-archived area shared by all plan sandboxes. */
export function agentRunNotesRoot(): string {
  return path.join(homedir(), ".pages", "temp");
}

/** Tests overlap in both directions using path components. */
export function overlapsWorkspacePath(first: string, second: string): boolean {
  return (
    containsWorkspacePath(first, second) || containsWorkspacePath(second, first)
  );
}

/** Only internal identifiers become directory or file names, never display names. */
export function requireRunNotesId(id: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/u.test(id))
    throw new AgentError("plan_notes_path_invalid");
}

/** Accepts only owned directories without links or permissions for other accounts. */
export async function requirePrivateNotesDirectory(
  directory: string,
): Promise<void> {
  const entry = await lstat(directory);
  if (
    !entry.isDirectory() ||
    entry.isSymbolicLink() ||
    entry.uid !== process.getuid?.() ||
    (entry.mode & 0o077) !== 0
  )
    throw new AgentError("plan_notes_path_invalid");
}

/** Rejects redirected or foreign-writable .pages parents before any cleanup or mount. */
export async function requireNotesRoot(root: string): Promise<string> {
  const parent = await lstat(path.dirname(root));
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    parent.uid !== process.getuid?.() ||
    (parent.mode & 0o022) !== 0
  )
    throw new AgentError("plan_notes_path_invalid");
  await requirePrivateNotesDirectory(root);
  return realpath(root);
}

/** Creates a private parent; an existing unsafe directory is never adopted. */
export async function ensurePrivateNotesDirectory(
  directory: string,
): Promise<void> {
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
  }
  await requirePrivateNotesDirectory(directory);
}
