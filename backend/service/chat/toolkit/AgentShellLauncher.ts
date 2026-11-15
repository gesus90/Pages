import { existsSync } from "node:fs";

import { probeBubblewrap } from "@/backend/agents/cli/CliPlanIsolation";

/** How one shell command starts: the program, its arguments and its environment. */
export interface AgentShellLaunch {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Turns a command of the agent into the process that runs it, or `null`
 * when the required isolation does not work on this host (PAGE-390).
 */
export type AgentShellLauncher = (
  command: string,
  root: string,
) => Promise<AgentShellLaunch | null>;

const BUBBLEWRAP = "/usr/bin/bwrap";
const SHELL = "/bin/sh";

/**
 * The environment of a command: no variable of the server process, so no
 * credential of Pages reaches the agent through it.
 */
function commandEnvironment(root: string): Readonly<Record<string, string>> {
  return {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: root,
    LANG: "C.UTF-8",
    TERM: "dumb",
  };
}

/**
 * The arguments that run a command inside bubblewrap: the system read-only,
 * only the working folder writable, a private `/tmp`, the runtime folder of
 * the account and the protected folders hidden, and its own process tree.
 */
export function bubblewrapArguments(
  command: string,
  root: string,
  hiddenDirectories: readonly string[] = [],
): string[] {
  const runtime =
    process.getuid === undefined ? null : `/run/user/${process.getuid()}`;
  const hidden = [
    ...hiddenDirectories,
    ...(runtime !== null && existsSync(runtime) ? [runtime] : []),
  ].filter((directory) => existsSync(directory));
  return [
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    ...hidden.flatMap((directory) => ["--tmpfs", directory]),
    "--bind",
    root,
    root,
    "--unshare-pid",
    "--die-with-parent",
    "--chdir",
    root,
    "--",
    SHELL,
    "-c",
    command,
  ];
}

/**
 * The launcher of an access level (PAGE-390).
 *
 * @param isIsolated - "Arbeitsplatz" runs every command in bubblewrap; YOLO
 * runs it directly with the rights of the server account.
 * @param options - The folders the isolation hides, and the probe of
 * bubblewrap, replaceable for tests.
 * @returns A launcher that refuses with `null` when the isolation an
 * "Arbeitsplatz" needs is missing, instead of running unisolated.
 */
export function createAgentShellLauncher(
  isIsolated: boolean,
  options: {
    readonly hiddenDirectories?: readonly string[];
    readonly probe?: () => Promise<boolean>;
  } = {},
): AgentShellLauncher {
  const probe = options.probe ?? probeBubblewrap;
  // One probe per job: the answer holds for every command of it.
  let isAvailable: Promise<boolean> | null = null;
  return async (command, root) => {
    const env = commandEnvironment(root);
    if (!isIsolated)
      return { file: SHELL, args: ["-c", command], cwd: root, env };
    isAvailable ??= probe();
    if (!(await isAvailable)) return null;
    return {
      file: BUBBLEWRAP,
      args: bubblewrapArguments(command, root, options.hiddenDirectories),
      cwd: root,
      env,
    };
  };
}
