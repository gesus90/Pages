import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";
import { isMissingPath } from "@/backend/service/agents/AgentCanonicalPath";
import { logCaughtError } from "@/backend/logging/Logger";

import type {
  AgentSessionGitState,
  AgentSessionWorkspace,
} from "@/definition/AgentSessionJournal";

/** Bytes read from a Git pointer file; a valid one is far shorter. */
const POINTER_BYTES = 1_024;
/** Parent folders searched for a repository above the workspace. */
const MAXIMUM_DEPTH = 64;
const BRANCH_REFERENCE = /^ref: refs\/heads\/(?<branch>[^\s]+)\s*$/u;
const COMMIT = /^(?<commit>[0-9a-f]{40}|[0-9a-f]{64})\s*$/u;
const GIT_DIRECTORY = /^gitdir: (?<directory>.+?)\s*$/u;

/** The files the workspace check reads; tests replace them. */
export interface WorkspaceFiles {
  readonly realpath: (target: string) => Promise<string>;
  /** Whether the path is a directory; `null` when it does not exist. */
  readonly isDirectory: (target: string) => Promise<boolean | null>;
  /** The first bytes of a file as text. */
  readonly readStart: (target: string) => Promise<string>;
}

async function readStart(target: string): Promise<string> {
  const file = await open(target, "r");
  try {
    const buffer = Buffer.alloc(POINTER_BYTES);
    const { bytesRead } = await file.read(buffer, 0, POINTER_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}

async function isDirectory(target: string): Promise<boolean | null> {
  try {
    return (await stat(target)).isDirectory();
  } catch (error: unknown) {
    if (isMissingPath(error)) return null;
    logCaughtError("AgentSessionWorkspace", error);
    throw error;
  }
}

const NODE_FILES: WorkspaceFiles = { realpath, isDirectory, readStart };

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function findGitDirectory(
  directory: string,
  files: WorkspaceFiles,
): Promise<string | null> {
  let current = directory;
  for (let depth = 0; depth < MAXIMUM_DEPTH; depth += 1) {
    const marker = path.join(current, ".git");
    const kind = await files.isDirectory(marker);
    if (kind === true) return marker;
    if (kind === false) {
      // A worktree or submodule names its Git directory in a `.git` file.
      const match = GIT_DIRECTORY.exec(await files.readStart(marker));
      const named = match?.groups?.directory;
      return named === undefined ? null : path.resolve(current, named);
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

/**
 * Reads the branch or commit of the repository that contains a directory.
 *
 * @param directory - A directory the caller already checked.
 * @param files - The file access, replaced in tests.
 * @returns The state from `HEAD` alone; no Git command and no command of the
 * model runs, and no path of the repository leaves this function.
 */
export async function readWorkspaceGit(
  directory: string,
  files: WorkspaceFiles = NODE_FILES,
): Promise<AgentSessionGitState> {
  try {
    const gitDirectory = await findGitDirectory(directory, files);
    if (gitDirectory === null) return { state: "no_repository" };
    const head = await files.readStart(path.join(gitDirectory, "HEAD"));
    const branch = BRANCH_REFERENCE.exec(head)?.groups?.branch;
    if (branch !== undefined) return { state: "branch", branch };
    const commit = COMMIT.exec(head)?.groups?.commit;
    if (commit !== undefined) return { state: "detached", commit };
    return { state: "unreadable" };
  } catch (caughtError: unknown) {
    logCaughtError("AgentSessionWorkspace", caughtError);

    // An unreadable repository is reported as such; the session itself is unaffected.
    return { state: "unreadable" };
  }
}

/**
 * Checks the directory a session works in and reads its Git state.
 *
 * @param assignment - The directory of the session and the workspace Pages assigned to it.
 * @param checkedAt - When the check ran.
 * @param files - The file access, replaced in tests.
 * @throws {AgentError} `workspace_path_invalid` for a directory outside the
 * assigned workspace, also through a symbolic link, or one that is gone.
 */
export async function checkSessionWorkspace(
  assignment: { readonly directory: string; readonly workspace: string },
  checkedAt: string,
  files: WorkspaceFiles = NODE_FILES,
): Promise<AgentSessionWorkspace> {
  let directory: string;
  let workspace: string;
  try {
    [directory, workspace] = await Promise.all([
      files.realpath(assignment.directory),
      files.realpath(assignment.workspace),
    ]);
  } catch (caughtError: unknown) {
    logCaughtError("AgentSessionWorkspace", caughtError);

    throw new AgentError("workspace_path_invalid");
  }
  if (
    !isInside(workspace, directory) ||
    (await files.isDirectory(directory)) !== true
  )
    throw new AgentError("workspace_path_invalid");
  return {
    directory,
    git: await readWorkspaceGit(directory, files),
    checkedAt,
  };
}
