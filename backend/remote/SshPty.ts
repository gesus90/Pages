import { quoteShellWord } from "./SshOptions";

import type { IPty } from "@lydell/node-pty";

/** Terminal geometry and the registered starting directory of one shell. */
export interface SshPtyRequest {
  readonly path: string;
  readonly columns: number;
  readonly rows: number;
  readonly onOutput: (chunk: string) => void;
}

/** A local PTY forwarding raw input and window changes through OpenSSH. */
export class SshPty {
  public readonly exited: Promise<number>;
  private readonly terminal: IPty;
  private isClosed = false;

  public constructor(terminal: IPty, request: SshPtyRequest) {
    this.terminal = terminal;
    terminal.onData(request.onOutput);
    this.exited = new Promise((resolve) => {
      terminal.onExit(({ exitCode }) => {
        this.isClosed = true;
        resolve(exitCode);
      });
    });
  }

  /** Sends terminal input verbatim, including control characters. */
  public write(input: string): void {
    this.terminal.write(input);
  }

  /** OpenSSH forwards the local SIGWINCH as an SSH window-change request. */
  public resize(columns: number, rows: number): void {
    this.terminal.resize(columns, rows);
  }

  /** Ends this shell without closing the connection used by other workspaces. */
  public close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.terminal.kill();
  }
}

/**
 * Opens a shell over an authenticated master, with no standalone authentication
 * fallback. The native module loads only when a console is requested.
 */
export async function openSshPty(input: {
  readonly file: string;
  readonly arguments: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
  readonly directory: string;
  readonly request: SshPtyRequest;
}): Promise<SshPty> {
  const { spawn } = await import("@lydell/node-pty");
  const { request } = input;
  const directory = quoteShellWord(request.path);
  // Fail closed if the canonical directory changed since the service checked it.
  const command = `cd -P ${directory} && [ "$(pwd -P)" = ${directory} ] && exec "\${SHELL:-/bin/sh}" -i`;
  const terminal = spawn(
    input.file,
    [
      "-tt",
      "-e",
      "none",
      "-o",
      "ProxyCommand=/bin/false",
      ...input.arguments,
      command,
    ],
    {
      name: "xterm-256color",
      cols: request.columns,
      rows: request.rows,
      cwd: input.directory,
      env: { ...input.environment, TERM: "xterm-256color" },
    },
  );
  return new SshPty(terminal, request);
}
