import { createHash } from "node:crypto";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { quoteShellWord } from "@/backend/remote/SshOptions";
import setupTemplate from "@/scripts/pages_setup.sh?raw";
import runnerTransport from "@/scripts/runner/transport.mjs?raw";
import runnerExecution from "@/scripts/runner/execution.mjs?raw";
import type { RemoteConnectionService } from "@/backend/service/remote/RemoteConnectionService";
import type { RemoteSessionRegistry } from "@/backend/remote/RemoteSessionRegistry";
import type { RunnerService } from "./RunnerService";

const setupScript = setupTemplate
  .replace("__PAGES_RUNNER_TRANSPORT__", () => runnerTransport)
  .replace("__PAGES_RUNNER_EXECUTION__", () => runnerExecution);

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

  private transferCommand(sha256: string): string {
    const encoded = Buffer.from(setupScript).toString("base64");
    return [
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
      'if test -e "$target"; then cmp -s -- "$temporary" "$target"; else ln -- "$temporary" "$target"; fi',
      `test \"$(sha256sum -- \"$target\" | cut -d ' ' -f 1)\" = ${quoteShellWord(sha256)}`,
      `printf '%s\\n' ${quoteShellWord(sha256)}`,
    ].join("\n");
  }
}
