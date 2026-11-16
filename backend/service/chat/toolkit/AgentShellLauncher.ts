import { readNativeHost } from "@/backend/agents/cli/CliNativeHost";
import { logCaughtError } from "@/backend/logging/Logger";

import type { CliNativeHost } from "@/backend/agents/cli/CliNativeHost";

/** How one shell command starts: the program, its arguments and its environment. */
export interface AgentShellLaunch {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Turns a command of the agent into the process that runs it, or `null`
 * when the host environment it needs cannot be read.
 */
export type AgentShellLauncher = (
  command: string,
  root: string,
) => Promise<AgentShellLaunch | null>;

const SHELL = "/bin/sh";

/**
 * The launcher of the shell tools, which only YOLO offers.
 * @param options - Reads the host environment; replaceable for tests.
 * @returns A launcher that starts every command natively with the rights of
 * the account: in the working folder, with the real home folder and the
 * account's login environment, so every program on its login `PATH` is
 * found. No variable of the Pages service reaches the command.
 * @remarks
 * The host environment is read once per job; a host whose login shell does
 * not answer gets `null`, which the shell tool reports, instead of a command
 * with a shortened `PATH`.
 */
export function createAgentShellLauncher(
  options: {
    readonly host?: (root: string) => Promise<CliNativeHost>;
  } = {},
): AgentShellLauncher {
  const read =
    options.host ??
    ((root: string) => readNativeHost(root, new AbortController().signal));
  let host: Promise<CliNativeHost | null> | null = null;
  return async (command, root) => {
    host ??= read(root).catch((error: unknown) => {
      logCaughtError("AgentShellLauncher", error);
      return null;
    });
    const environment = await host;
    if (environment === null) return null;
    return {
      file: SHELL,
      args: ["-c", command],
      cwd: root,
      env: { ...environment.environment, HOME: environment.home },
    };
  };
}
