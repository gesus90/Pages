import { spawn } from "node:child_process";

import { AgentError } from "@/backend/error/AgentErrors";

import { CliChildProcess } from "./CliChildProcess";
import { createCliEnvironment } from "./CliEnvironment";

import type {
  CliGroupSignal,
  CliProcessResult,
  CliRunningProcess,
  CliRunRequest,
  CliSpawn,
} from "./CliContracts";

interface RunnerDependencies {
  readonly spawn?: CliSpawn;
  readonly signalGroup?: CliGroupSignal;
}

/** Runs at most four CLI children with isolated environments and no shell. */
export class CliProcessRunner {
  private readonly spawnProcess: CliSpawn;
  private readonly signalGroup: CliGroupSignal;
  private readonly active = new Set<CliRunningProcess>();
  private isShuttingDown = false;

  public constructor(dependencies: RunnerDependencies = {}) {
    this.spawnProcess = dependencies.spawn ?? spawn;
    this.signalGroup = dependencies.signalGroup ?? process.kill;
  }

  /** Login callers keep the process handle only while its session is active. */
  public start(request: CliRunRequest): CliRunningProcess {
    if (this.isShuttingDown || this.active.size >= 4)
      throw new AgentError("login_limit_reached");
    if (request.signal?.aborted) throw new AgentError("check_timeout");
    // spawn is synchronous: the child inherits 0077 before another JS task can run.
    const previousMask = process.umask(0o077);
    let running: CliRunningProcess;
    try {
      const child = this.spawnProcess(request.file, request.arguments, {
        shell: false,
        detached: true,
        cwd: request.home.work,
        env: createCliEnvironment(request.home, request.provider, request.file),
        stdio: [request.stdin, "pipe", "pipe"],
      });
      running = new CliChildProcess(child, request, this.signalGroup);
    } catch {
      throw new AgentError("cli_not_executable");
    } finally {
      process.umask(previousMask);
    }
    this.active.add(running);
    void running.completed.then(() => {
      this.active.delete(running);
    });
    return running;
  }

  /** Checks expose a structured failure instead of a native spawn error. */
  public async run(request: CliRunRequest): Promise<CliProcessResult> {
    try {
      return await this.start(request).completed;
    } catch (error: unknown) {
      return {
        exitCode: null,
        stdout: "",
        stderr: "",
        errorCode:
          error instanceof AgentError ? error.code : "cli_not_executable",
      };
    }
  }

  /** Drains process groups before the application closes its database and exits. */
  public async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    const running = [...this.active];
    for (const child of running) child.cancel("login_cancelled");
    await Promise.all(running.map((child) => child.completed));
  }
}
