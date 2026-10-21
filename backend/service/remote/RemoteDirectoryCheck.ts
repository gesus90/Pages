import path from "node:path";

import { quoteShellWord } from "@/backend/remote/SshOptions";

import type { RemoteSession } from "@/backend/remote/RemoteSession";
import type { RemotePathIssue } from "@/definition/RemoteConnection";

/** What the check found: the canonical path, or why the directory cannot serve. */
export interface RemoteDirectoryFinding {
  readonly path: string | null;
  readonly issue: RemotePathIssue | null;
}

/** The directory to check and the directories it must lie in. */
export interface RemoteDirectoryRequest {
  /** The absolute path as registered or typed. */
  readonly path: string;
  /** The connection's allowed directories as configured; never empty. */
  readonly roots: readonly string[];
}

/** What the script printed: fixed findings and, for a usable directory, its canonical path. */
interface CheckOutput {
  readonly findings: ReadonlyMap<string, string>;
  readonly canonical: string | null;
}

// Longer than the keepalive needs to notice a dead transport (about 30 to 40 s),
// so a broken connection is reported as such rather than as a slow check.
const CHECK_TIMEOUT_MILLISECONDS = 60_000;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const PATH_MARKER = "\npages-path=";

/**
 * A read-only POSIX shell script: it changes nothing on the machine and
 * prints one `key=value` line per finding, the canonical path last.
 *
 * @remarks
 * A directory the account can enter is judged by its canonical path, so
 * neither `..` nor a symbolic link leads out of the roots. Each root counts
 * as written and as resolved on the machine, so a root behind a symbolic link
 * keeps its meaning. A path that cannot be entered is judged by its normalized
 * form first, so a path outside the roots is refused as such and does not
 * reveal whether it exists. The shell compares whole strings and prints only
 * fixed words, so no name on the machine can forge a finding.
 */
function checkScript(request: RemoteDirectoryRequest): string {
  const roots = request.roots.map(quoteShellWord).join(" ");
  return [
    `p=${quoteShellWord(request.path)}`,
    `n=${quoteShellWord(path.posix.normalize(request.path))}`,
    `set --`,
    `for r in ${roots}; do set -- "$@" "$r"; q=$(cd -P "$r" 2>/dev/null && pwd -P) && set -- "$@" "$q"; done`,
    `within() { c=$1; shift; for b in "$@"; do [ "$b" = / ] && return 0; case "$c" in "$b"|"$b"/*) return 0;; esac; done; return 1; }`,
    `if [ -d "$p" ] && cd "$p" 2>/dev/null; then`,
    `if within "$(pwd -P)" "$@"; then`,
    `[ -r . ] && echo pages-read=1`,
    `[ -w . ] && echo pages-write=1`,
    `[ -x . ] && echo pages-traverse=1`,
    `echo pages-check=ok`,
    `printf 'pages-path='; pwd -P`,
    `else echo pages-check=outside; fi`,
    `elif ! within "$n" "$@"; then echo pages-check=outside`,
    `elif [ ! -e "$p" ]; then echo pages-check=missing`,
    `elif [ ! -d "$p" ]; then echo pages-check=not_directory`,
    `else echo pages-check=denied; fi`,
  ].join("\n");
}

/** The fixed findings, and the canonical path taken verbatim up to its final line break. */
function readOutput(stdout: string): CheckOutput {
  const marker = stdout.indexOf(PATH_MARKER);
  const findings = new Map<string, string>();
  const head = marker < 0 ? stdout : stdout.slice(0, marker);
  for (const line of head.split("\n")) {
    const match = /^pages-([a-z]+)=(.*)$/u.exec(line);
    if (match) findings.set(match[1], match[2]);
  }
  const canonical =
    marker < 0
      ? null
      : stdout.slice(marker + PATH_MARKER.length).replace(/\n$/u, "");
  return { findings, canonical };
}

const CHECK_ISSUES: ReadonlyMap<string, RemotePathIssue> = new Map([
  ["missing", "path_missing"],
  ["not_directory", "path_not_directory"],
  ["denied", "path_denied"],
  ["outside", "path_outside_roots"],
]);

function permissionIssue(
  findings: ReadonlyMap<string, string>,
): RemotePathIssue | null {
  if (findings.get("read") !== "1") return "path_not_readable";
  if (findings.get("write") !== "1") return "path_not_writable";
  if (findings.get("traverse") !== "1") return "path_not_traversable";
  return null;
}

/**
 * Checks a directory on the remote machine: that it lies within the allowed
 * directories, its existence, kind and the read, write and traverse rights of
 * the SSH account.
 *
 * @param session - The logical connection of the workspace's connection.
 * @param request - The path and the connection's allowed directories.
 * @returns The canonical path and the first issue found.
 * @throws {RemoteError} When the connection cannot run the check; then nothing is known.
 */
export async function checkRemoteDirectory(
  session: Pick<RemoteSession, "run">,
  request: RemoteDirectoryRequest,
): Promise<RemoteDirectoryFinding> {
  const result = await session.run(
    checkScript(request),
    CHECK_TIMEOUT_MILLISECONDS,
  );
  const { findings, canonical } = readOutput(result.stdout);
  const state = findings.get("check");
  if (state === undefined) return { path: null, issue: "path_denied" };
  const known = CHECK_ISSUES.get(state);
  if (known !== undefined) return { path: null, issue: known };
  if (
    canonical === null ||
    !canonical.startsWith("/") ||
    CONTROL_CHARACTERS.test(canonical)
  )
    return { path: null, issue: "path_denied" };
  return { path: canonical, issue: permissionIssue(findings) };
}
