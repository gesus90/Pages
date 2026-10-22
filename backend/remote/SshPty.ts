import { quoteShellWord } from "./SshOptions";

import type { IPty } from "@lydell/node-pty";

/** Terminal geometry and the starting directory of one shell. */
export interface SshPtyRequest {
  /** The registered directory to start in, or `null` for the login directory. */
  readonly path: string | null;
  readonly columns: number;
  readonly rows: number;
  readonly onOutput: (chunk: string) => void;
}

/** OpenSSH reports a refused terminal before any output of the shell. */
const PTY_REFUSED = "PTY allocation request failed";
const REFUSAL_WINDOW = 512;

/**
 * The browser terminal reads and writes UTF-8 only. A shell that the machine
 * starts without any locale gets `C.UTF-8` when the machine has it; a locale
 * of the system or of the user's start files stays in force.
 */
const UTF8_DEFAULT = `if [ -z "\${LC_ALL:-\${LC_CTYPE:-\${LANG:-}}}" ] && locale -a 2>/dev/null | grep -qiE "^c[.]utf-?8$"; then export LANG=C.UTF-8; fi`;

/**
 * The remote command of a shell: a login shell in the login directory, or an
 * interactive shell in the checked directory. `/bin/sh` runs the preparation,
 * so the user's own shell may use any syntax.
 */
function remoteCommand(path: string | null): string {
  let start = `exec "\${SHELL:-/bin/sh}" -l`;
  if (path !== null) {
    const directory = quoteShellWord(path);
    // Fail closed if the canonical directory changed since the service checked it.
    start = `cd -P ${directory} && [ "$(pwd -P)" = ${directory} ] && exec "\${SHELL:-/bin/sh}" -i`;
  }
  return `exec /bin/sh -c ${quoteShellWord(`${UTF8_DEFAULT}; ${start}`)}`;
}

/** A local PTY forwarding raw input and window changes through OpenSSH. */
export class SshPty {
  public readonly exited: Promise<number>;
  /** Settles with the first output: `false` when the terminal was refused or the shell ended first. */
  public readonly firstOutput: Promise<boolean>;
  private readonly terminal: IPty;
  private settleFirstOutput: ((isShell: boolean) => void) | null = null;
  private isClosed = false;
  private isRefused = false;
  private hasInput = false;
  private earlyOutput = "";

  public constructor(terminal: IPty, request: SshPtyRequest) {
    this.terminal = terminal;
    this.firstOutput = new Promise((resolve) => {
      this.settleFirstOutput = resolve;
    });
    terminal.onData((chunk) => {
      this.watchRefusal(chunk);
      this.settleFirstOutput?.(!this.isRefused);
      request.onOutput(chunk);
    });
    this.exited = new Promise((resolve) => {
      terminal.onExit(({ exitCode }) => {
        this.isClosed = true;
        this.settleFirstOutput?.(false);
        resolve(exitCode);
      });
    });
  }

  /** Sends terminal input verbatim, including control characters. */
  public write(input: string): void {
    this.hasInput = true;
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

  /** Whether the machine refused the terminal; such a shell is ended at once. */
  public wasRefused(): boolean {
    return this.isRefused;
  }

  // Without a terminal the shell would run without echo or job control. Only
  // output before the first keystroke counts, so typed text never matches.
  private watchRefusal(chunk: string): void {
    if (this.hasInput || this.earlyOutput.length >= REFUSAL_WINDOW) return;
    this.earlyOutput += chunk;
    if (!this.earlyOutput.includes(PTY_REFUSED)) return;
    this.isRefused = true;
    this.close();
  }
}

/**
 * Opens a shell over an authenticated master, with no standalone authentication
 * fallback. The native module loads only when a console is requested.
 *
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
  const terminal = spawn(
    input.file,
    [
      "-tt",
      "-e",
      "none",
      "-o",
      "ProxyCommand=/bin/false",
      ...input.arguments,
      remoteCommand(request.path),
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
