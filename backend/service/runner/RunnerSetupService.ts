import { createHash } from "node:crypto";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { RemoteError } from "@/backend/error/RemoteErrors";
import { quoteShellWord } from "@/backend/remote/SshOptions";
import setupTemplate from "@/scripts/pages_setup.sh?raw";
import serviceManager from "@/scripts/runner/service-manager.sh?raw";
import runnerTransport from "@/scripts/runner/transport.mjs?raw";
import runnerExecution from "@/scripts/runner/execution.mjs?raw";
import runnerGitHub from "@/scripts/runner/github.mjs?raw";
import runnerCli from "@/scripts/runner/cli.mjs?raw";
import runnerPages from "@/scripts/runner/pages.mjs?raw";
import runnerOpenCode from "@/scripts/runner/opencode.mjs?raw";
import runnerLive from "@/scripts/runner/live.mjs?raw";
import runnerSchedule from "@/scripts/runner/schedule.mjs?raw";
import runnerJournal from "@/scripts/runner/journal.mjs?raw";
import runnerProvider from "@/scripts/runner/provider.mjs?raw";
import runnerChunks from "@/scripts/runner/chunks.mjs?raw";
import runnerLines from "@/scripts/runner/lines.mjs?raw";
import runnerOutput from "@/scripts/runner/output.mjs?raw";
import runnerResult from "@/scripts/runner/result.mjs?raw";
import runnerWire from "@/scripts/runner/wire.mjs?raw";
import type { RemoteConnectionService } from "@/backend/service/remote/RemoteConnectionService";
import type { RemoteSessionRegistry } from "@/backend/remote/RemoteSessionRegistry";
import type { RunnerService } from "./RunnerService";

const setupScript = setupTemplate
  .replace("__PAGES_SERVICE_MANAGER__", () => serviceManager)
  .replace("__PAGES_RUNNER_TRANSPORT__", () => runnerTransport)
  .replace("__PAGES_RUNNER_EXECUTION__", () => runnerExecution)
  .replace("__PAGES_RUNNER_CLI__", () => runnerCli)
  .replace("__PAGES_RUNNER_PAGES__", () => runnerPages)
  .replace("__PAGES_RUNNER_OPENCODE__", () => runnerOpenCode)
  .replace("__PAGES_RUNNER_LIVE__", () => runnerLive)
  .replace("__PAGES_RUNNER_SCHEDULE__", () => runnerSchedule)
  .replace("__PAGES_RUNNER_JOURNAL__", () => runnerJournal)
  .replace("__PAGES_RUNNER_PROVIDER__", () => runnerProvider)
  .replace("__PAGES_RUNNER_CHUNKS__", () => runnerChunks)
  .replace("__PAGES_RUNNER_LINES__", () => runnerLines)
  .replace("__PAGES_RUNNER_OUTPUT__", () => runnerOutput)
  .replace("__PAGES_RUNNER_RESULT__", () => runnerResult)
  .replace("__PAGES_RUNNER_WIRE__", () => runnerWire)
  .replace("__PAGES_RUNNER_GITHUB__", () => runnerGitHub);

/** Runs the lines under a POSIX shell, whichever login shell the user has. */
function shellCommand(lines: readonly string[]): string {
  return `/bin/sh -c ${quoteShellWord(lines.join("\n"))}`;
}

/** Delivers the reviewed setup artifact through the existing pinned SSH master, without execution. */
export class RunnerSetupService {
  private readonly runners: RunnerService;
  private readonly connections: RemoteConnectionService;
  private readonly sessions: RemoteSessionRegistry;
  private readonly directory: string;
  private readonly transfers = new SerialQueue();

  public constructor(input: {
    readonly runners: RunnerService;
    readonly connections: RemoteConnectionService;
    readonly sessions: RemoteSessionRegistry;
    readonly directory?: string;
  }) {
    this.runners = input.runners;
    this.connections = input.connections;
    this.sessions = input.sessions;
    const directory = input.directory ?? ".";
    if (directory !== "." && !/^[a-zA-Z0-9_-]{1,80}$/u.test(directory))
      throw new Error("Invalid runner setup directory");
    this.directory = directory;
  }

  /** Returns the exact same script that the SSH transfer carries. */
  public script(): string {
    return setupScript;
  }

  /** Opens an authenticated transport for an administrator; the overview waits for stability. */
  public async connect(userId: string, connectionId: string): Promise<void> {
    const scope = await this.connections.scope(userId);
    if (
      !scope.canManage ||
      !scope.connections.some((entry) => entry.id === connectionId)
    )
      throw new Error("Runner administration required");
    const result = await this.sessions
      .session(connectionId)
      .run("true", 15_000);
    if (result.exitCode !== 0) throw new Error("SSH connection unavailable");
  }

  /** Transfers atomically, verifies SHA-256 and bash syntax, and never starts the script. */
  public async transfer(
    userId: string,
    connectionId: string,
  ): Promise<{ readonly path: string; readonly sha256: string }> {
    return this.transfers.run(async () => {
      await this.runners.requireSetup(userId, connectionId);
      const connection = await this.connections.requireUsable(
        userId,
        connectionId,
      );
      const session = this.sessions.session(connectionId);
      const sha256 = createHash("sha256").update(setupScript).digest("hex");
      const result = await session.run(this.transferCommand(sha256), 30_000);
      if (result.exitCode !== 0 || result.stdout.trim() !== sha256)
        throw new Error("Setup transfer or verification failed");
      const current = await this.connections.requireUsable(
        userId,
        connectionId,
      );
      if (current.revision !== connection.revision)
        throw new Error("SSH configuration changed during transfer");
      return {
        path:
          this.directory === "."
            ? "~/pages_setup.sh"
            : `~/${this.directory}/pages_setup.sh`,
        sha256,
      };
    });
  }

  /**
   * Checks the delivered file again, apart from the transfer: SHA-256 and bash syntax.
   *
   * @param userId - The administrator who runs the setup.
   * @param connectionId - The connection.
   * @throws {RemoteError} `remote_setup_failed` when the file differs or does not parse.
   */
  public async verify(userId: string, connectionId: string): Promise<void> {
    await this.connections.requireSetup(userId, connectionId);
    const sha256 = createHash("sha256").update(setupScript).digest("hex");
    const result = await this.sessions
      .session(connectionId)
      .run(this.verifyCommand(sha256), 30_000);
    if (result.exitCode !== 0 || result.stdout.trim() !== sha256)
      throw new RemoteError("remote_setup_failed");
  }

  /**
   * Makes the delivered file executable for its owner only.
   *
   * @param userId - The administrator who runs the setup.
   * @param connectionId - The connection.
   * @throws {RemoteError} `remote_setup_failed` unless the file has exactly mode 0700.
   */
  public async makeExecutable(
    userId: string,
    connectionId: string,
  ): Promise<void> {
    await this.connections.requireSetup(userId, connectionId);
    const result = await this.sessions
      .session(connectionId)
      .run(this.permissionCommand(), 15_000);
    if (result.exitCode !== 0) throw new RemoteError("remote_setup_failed");
  }

  /**
   * The command that starts the delivered script in a terminal.
   *
   * @remarks
   * Progress markers are switched on for this start only, so a person who
   * runs the script by hand sees plain text.
   *
   * @returns A command line for a POSIX shell.
   */
  public launchCommand(): string {
    return `PAGES_SETUP_PROGRESS=1 exec ${this.location()}`;
  }

  private location(): string {
    return this.directory === "."
      ? '"$HOME"/pages_setup.sh'
      : `"$HOME"/${this.directory}/pages_setup.sh`;
  }

  private verifyCommand(sha256: string): string {
    return shellCommand([
      "set -eu",
      `target=${this.location()}`,
      'test -f "$target" && test ! -L "$target"',
      `test \"$(sha256sum -- \"$target\" | cut -d ' ' -f 1)\" = ${quoteShellWord(sha256)}`,
      'bash -n -- "$target"',
      `printf '%s\\n' ${quoteShellWord(sha256)}`,
    ]);
  }

  private permissionCommand(): string {
    return shellCommand([
      "set -eu",
      `target=${this.location()}`,
      'test -f "$target" && test ! -L "$target"',
      'chmod u=rwx,go= -- "$target"',
      'test "$(stat -c %a -- "$target")" = 700',
    ]);
  }

  private transferCommand(sha256: string): string {
    const encoded = Buffer.from(setupScript).toString("base64");
    return shellCommand([
      "set -eu",
      "umask 077",
      `directory=\"$HOME\"/${quoteShellWord(this.directory)}`,
      'test ! -L "$directory"',
      'mkdir -p -- "$directory"',
      'target="$directory/pages_setup.sh"',
      'temporary=$(mktemp "$directory/.pages-setup.XXXXXX")',
      "trap 'rm -f -- \"$temporary\"' EXIT HUP INT TERM",
      `printf '%s' ${quoteShellWord(encoded)} | base64 -d > \"$temporary\"`,
      `test \"$(sha256sum -- \"$temporary\" | cut -d ' ' -f 1)\" = ${quoteShellWord(sha256)}`,
      'bash -n -- "$temporary"',
      'test ! -L "$target"',
      'if test -e "$target"; then',
      '  if ! cmp -s -- "$temporary" "$target"; then',
      // Only an earlier delivery of this artifact is replaced, never another file.
      "    head -n 3 -- \"$target\" | grep -q '^# Pages delivers this file' || exit 1",
      '    mv -f -- "$temporary" "$target"',
      "  fi",
      'else ln -- "$temporary" "$target"; fi',
      `test \"$(sha256sum -- \"$target\" | cut -d ' ' -f 1)\" = ${quoteShellWord(sha256)}`,
      `printf '%s\\n' ${quoteShellWord(sha256)}`,
    ]);
  }
}
