import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { randomUUID } from "node:crypto";

import type { ChildProcess } from "node:child_process";
import type { AgentShellLaunch } from "./AgentShellLauncher";

/** Characters of output a run keeps; older output is dropped first. */
const MAXIMUM_OUTPUT = 200_000;
/** Background runs of one job at the same time. */
const MAXIMUM_RUNNING = 4;
/** The longest a background run may take before Pages ends it. */
const MAXIMUM_BACKGROUND_MS = 60 * 60 * 1000;

/** The state of a run. */
export type AgentShellState = "running" | "exited" | "killed" | "timedOut";

/** What a finished foreground command reports. */
export interface AgentShellResult {
  readonly state: AgentShellState;
  readonly exitCode: number | null;
  readonly output: string;
  readonly isTruncated: boolean;
  readonly durationMs: number;
}

/** What a status query of a background run reports. */
export interface AgentShellStatus {
  readonly jobId: string;
  readonly state: AgentShellState;
  readonly exitCode: number | null;
  /** The output since the given offset. */
  readonly output: string;
  /** The offset to pass next time to read only newer output. */
  readonly offset: number;
  readonly hasDroppedOutput: boolean;
}

interface Run {
  readonly process: ChildProcess;
  readonly startedAt: number;
  state: AgentShellState;
  exitCode: number | null;
  /** The kept output; `dropped` characters before it are gone. */
  output: string;
  dropped: number;
  readonly finished: Promise<void>;
  timer: NodeJS.Timeout | null;
}

/** Starts a process with the shell's output joined into one stream. */
function startRun(launch: AgentShellLaunch, limitMs: number): Run {
  const child = spawn(launch.file, [...launch.args], {
    cwd: launch.cwd,
    env: { ...launch.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let resolveFinished: () => void = () => undefined;
  const run: Run = {
    process: child,
    startedAt: Date.now(),
    state: "running",
    exitCode: null,
    output: "",
    dropped: 0,
    finished: new Promise<void>((resolve) => {
      resolveFinished = resolve;
    }),
    timer: null,
  };
  const append = (chunk: Buffer): void => {
    run.output += chunk.toString("utf8");
    if (run.output.length > MAXIMUM_OUTPUT) {
      const excess = run.output.length - MAXIMUM_OUTPUT;
      run.output = run.output.slice(excess);
      run.dropped += excess;
    }
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  run.timer = setTimeout(() => {
    run.state = "timedOut";
    stopProcess(child);
  }, limitMs);
  const finish = (code: number | null): void => {
    if (run.timer) clearTimeout(run.timer);
    run.timer = null;
    if (run.state === "running") run.state = "exited";
    run.exitCode = code;
    resolveFinished();
  };
  child.on("error", (error) => {
    append(Buffer.from(`${error.message}\n`));
    finish(null);
  });
  child.on("close", (code) => finish(code));
  return run;
}

/** How long the end of a process group is awaited before the stop counts as unconfirmed. */
const GROUP_END_TIMEOUT_MS = 5_000;
const GROUP_END_POLL_MS = 50;

/** Ends the whole process group of a run, so no child of the shell outlives it. */
function stopProcess(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function hasVanished(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

/**
 * Ends every process of a run's group, the children a finished shell left
 * behind included, and confirms that none is left.
 * @throws {Error} When a process of the group is still there after the wait.
 * @remarks
 * The group is the one the run's own `detached` spawn created, so no process
 * outside the run is signalled.
 */
async function endProcessGroup(child: ChildProcess): Promise<void> {
  const groupId = child.pid;
  if (groupId === undefined) return;
  const deadline = Date.now() + GROUP_END_TIMEOUT_MS;
  for (;;) {
    try {
      process.kill(-groupId, "SIGKILL");
    } catch (error: unknown) {
      if (hasVanished(error)) return;
      throw error;
    }
    if (Date.now() >= deadline)
      throw new Error("A shell process group did not end");
    await wait(GROUP_END_POLL_MS);
  }
}

/**
 * The shell runs of one chat job: foreground commands with a time
 * limit and background runs whose output and end the agent queries.
 *
 * @remarks
 * Every run belongs to the job that started it; {@link AgentShellJobs.close}
 * ends the runs still going when the job ends, so no process keeps working
 * in a working folder that Pages removes afterwards.
 */
export class AgentShellJobs {
  private readonly runs = new Map<string, Run>();

  /**
   * Runs a command and waits for its end.
   *
   * @param launch - The process to start.
   * @param timeoutMs - When Pages ends the command.
   * @param signal - Ends the command when the turn is cancelled.
   */
  public async runForeground(
    launch: AgentShellLaunch,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<AgentShellResult> {
    const run = startRun(launch, timeoutMs);
    // Kept with the job, so a process the command left behind ends with it.
    this.runs.set(randomUUID(), run);
    const abort = (): void => {
      run.state = "killed";
      stopProcess(run.process);
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      await run.finished;
    } finally {
      signal.removeEventListener("abort", abort);
    }
    return {
      state: run.state,
      exitCode: run.exitCode,
      output: run.output,
      isTruncated: run.dropped > 0,
      durationMs: Date.now() - run.startedAt,
    };
  }

  /**
   * Starts a command in the background.
   *
   * @returns The ID to query it with, or `null` when the job runs the most
   * background commands it may.
   */
  public startBackground(launch: AgentShellLaunch): string | null {
    const running = [...this.runs.values()].filter(
      (run) => run.state === "running",
    );
    if (running.length >= MAXIMUM_RUNNING) return null;
    const id = randomUUID();
    this.runs.set(id, startRun(launch, MAXIMUM_BACKGROUND_MS));
    return id;
  }

  /**
   * Reports a background run.
   *
   * @param id - The ID {@link startBackground} returned.
   * @param offset - Leaves out the output before this offset.
   * @returns The state and the newer output, or `null` for an unknown ID.
   */
  public status(id: string, offset = 0): AgentShellStatus | null {
    const run = this.runs.get(id);
    if (!run) return null;
    const total = run.dropped + run.output.length;
    const start = Math.max(0, Math.min(offset, total) - run.dropped);
    return {
      jobId: id,
      state: run.state,
      exitCode: run.exitCode,
      output: run.output.slice(start),
      offset: total,
      hasDroppedOutput: offset < run.dropped,
    };
  }

  /**
   * Ends a background run and every process it left; returns whether the ID was known.
   * @throws {Error} When the end of the run's processes cannot be confirmed.
   */
  public async stop(id: string): Promise<boolean> {
    const run = this.runs.get(id);
    if (!run) return false;
    if (run.state === "running") {
      run.state = "killed";
      stopProcess(run.process);
    }
    await endProcessGroup(run.process);
    await run.finished;
    return true;
  }

  /** Ends every run and every process a run left behind; the job that owned them ended. */
  public async close(): Promise<void> {
    await Promise.all([...this.runs.keys()].map((id) => this.stop(id)));
    this.runs.clear();
  }
}
