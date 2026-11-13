import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { readSwarmStatus } from "./SwarmWorkspaceState";

import type { SwarmWorkspaceState } from "./SwarmWorkspaceState";

const execute = promisify(execFile);

/** The most status entries whose content is read; beyond it only the status line counts. */
const CONTENT_ENTRY_LIMIT = 5000;

/** The largest file whose content is hashed; a larger one counts by its size and time only. */
const CONTENT_BYTES_LIMIT = 16 * 1024 * 1024;

const GIT_OPTIONS = { timeout: 30_000, maxBuffer: 64 * 1024 * 1024 };

/** Reads the state of a working directory for the swarm check. */
export interface SwarmWorkspaceProbe {
  snapshot(): Promise<SwarmWorkspaceState>;
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execute("git", [...args], { ...GIT_OPTIONS, cwd });
  return stdout;
}

async function contentDigest(file: string): Promise<string> {
  try {
    const content = await readFile(file);
    if (content.byteLength > CONTENT_BYTES_LIMIT)
      return `size:${String(content.byteLength)}`;
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return "missing";
  }
}

/**
 * Reads the working directory with Git, read-only (PAGE-313).
 *
 * @remarks
 * It takes `git status --porcelain=v2 -z --untracked-files=all`, so changes,
 * new files, deletions and renames count, the commit of `HEAD` and a digest
 * of the index from `git ls-files --stage -z`. Nothing is written: no
 * `git add`, no index refresh by a write command, no lock file.
 */
export class SwarmGitProbe implements SwarmWorkspaceProbe {
  private readonly directory: string;

  /** @param directory - The working directory of the swarm, inside a Git work tree. */
  public constructor(directory: string) {
    this.directory = directory;
  }

  /** Reads the current state. */
  public async snapshot(): Promise<SwarmWorkspaceState> {
    const [status, head, index] = await Promise.all([
      git(this.directory, [
        "--no-optional-locks",
        "status",
        "--porcelain=v2",
        "-z",
        "--untracked-files=all",
        "--",
        ".",
      ]),
      git(this.directory, ["rev-parse", "--verify", "-q", "HEAD"]).catch(
        () => "",
      ),
      git(this.directory, ["ls-files", "--stage", "-z"]),
    ]);
    const root = (
      await git(this.directory, ["rev-parse", "--show-toplevel"])
    ).trim();
    const prefix = path.relative(root, this.directory);
    const entries = new Map<string, string>();
    for (const [position, entry] of readSwarmStatus(status).entries()) {
      const relative = prefix
        ? path.posix.relative(prefix.split(path.sep).join("/"), entry.path)
        : entry.path;
      const digest =
        position < CONTENT_ENTRY_LIMIT
          ? await contentDigest(path.join(root, entry.path))
          : "unread";
      entries.set(relative, `${entry.signature} ${digest}`);
      if (entry.origin !== undefined)
        entries.set(
          prefix
            ? path.posix.relative(
                prefix.split(path.sep).join("/"),
                entry.origin,
              )
            : entry.origin,
          `renamed-to ${relative}`,
        );
    }
    return {
      head: head.trim(),
      index: createHash("sha256").update(index).digest("hex"),
      entries,
    };
  }
}
