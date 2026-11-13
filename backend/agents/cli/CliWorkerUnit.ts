import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  logCaughtError,
  logDiagnostic,
  logEvent,
} from "@/backend/logging/Logger";

import { createCliEnvironment } from "./CliEnvironment";

import type {
  CliSessionRequest,
  CliWorkerUnitHandle,
  CliWorkerUnitResult,
} from "./CliContracts";

const SYSTEMD_RUN = "/usr/bin/systemd-run";
const SYSTEMCTL = "/usr/bin/systemctl";
const TRUE_BINARY = "/usr/bin/true";
const UNIT_PREFIX = "pages-acp-";
const UNIT_SLICE = "pages-acp.slice";
/** A failed probe is repeated after this long, like the namespace probe. */
const RETRY_FAILED_PROBE_MS = 60_000;
const COMMAND_TIMEOUT_MS = 10_000;
/** The hard runtime of a worker without a deadline of its own. */
const UNBOUNDED_RUNTIME_SECONDS = 24 * 60 * 60;
/** systemd ends a worker this long after the deadline Pages itself enforces. */
const RUNTIME_GRACE_SECONDS = 120;
const execFileAsync = promisify(execFile);

/**
 * The limits of one ACP worker: adapter, runner, MCP bridge and every helper
 * they start, counted together in the cgroup of its unit.
 *
 * @remarks
 * Memory and swap have no ceiling per worker (`infinity`), because all workers
 * share the budget of `ACP_SLICE_LIMITS`. `OOMPolicy=kill` ends the whole worker
 * if the kernel kills one of its processes, and `oomScoreAdjust` makes the
 * kernel choose a worker before the platform when the host runs out of memory.
 * Tasks, CPU and runtime stay bounded; see `docs/AgentWorkerMemory.md`.
 */
export const ACP_WORKER_LIMITS = {
  memoryMax: "infinity",
  memorySwapMax: "infinity",
  tasksMax: 512,
  cpuQuota: "200%",
  oomScoreAdjust: 500,
} as const;

/**
 * The memory budget all ACP workers share in `pages-acp.slice`.
 *
 * @remarks
 * Starting values for the server with 22 GB; see `docs/AgentWorkerMemory.md`.
 */
export const ACP_SLICE_LIMITS = {
  memoryMax: "10G",
  memorySwapMax: "2G",
} as const;

/** A command of the user's service manager, run without a shell. */
export type CliWorkerCommand = (
  file: string,
  args: readonly string[],
) => Promise<{ readonly stdout: string }>;

function runCommand(
  file: string,
  args: readonly string[],
): Promise<{ readonly stdout: string }> {
  return execFileAsync(file, [...args], {
    timeout: COMMAND_TIMEOUT_MS,
    env: managerEnvironment(),
  });
}

/**
 * The service manager of this account is reached through its runtime directory only.
 *
 * @remarks
 * The bus address is named explicitly, because a worker's own environment
 * may point it elsewhere on purpose, such as the GitHub helper's empty bus;
 * that value stays in the worker's environment file.
 */
function managerEnvironment(): Record<string, string> {
  const runtimeDirectory = `/run/user/${process.getuid?.() ?? 0}`;
  return {
    PATH: "/usr/bin:/bin",
    XDG_RUNTIME_DIR: runtimeDirectory,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtimeDirectory}/bus`,
  };
}

/** Quotes one value for an environment file of systemd, which never expands it. */
function environmentLine(name: string, value: string): string {
  if (/[\0\n\r]/u.test(value) || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))
    throw new Error("An environment value cannot be passed to a worker unit.");
  return `${name}="${value.replace(/[\\"$`]/gu, (character) => `\\${character}`)}"`;
}

function readResult(text: string): CliWorkerUnitResult {
  const result = text.trim();
  const known: readonly CliWorkerUnitResult[] = [
    "success",
    "oom-kill",
    "timeout",
    "exit-code",
    "signal",
    "core-dump",
    "resources",
  ];
  return known.find((entry) => entry === result) ?? "unknown";
}

/**
 * Stops every worker unit of one session that is still loaded.
 *
 * @param instanceId - The tag of the session; its units carry it in their name.
 * @param command - Runs `systemctl`; defaults to a real process.
 * @returns How many units were found.
 *
 * @remarks
 * A unit name holds the session's random instance identifier, so a unit
 * found by it belongs to that session and to nothing else. Stopping it ends
 * all processes in its cgroup, also helpers that left the process group.
 */
export async function stopWorkerUnits(
  instanceId: string,
  command: CliWorkerCommand = runCommand,
): Promise<number> {
  if (!/^[A-Za-z0-9-]+$/u.test(instanceId)) return 0;
  const listed = await command(SYSTEMCTL, [
    "--user",
    "list-units",
    "--all",
    "--plain",
    "--no-legend",
    "--type=service",
    `${UNIT_PREFIX}${instanceId}-*`,
  ]);
  const names = listed.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/u)[0] ?? "")
    .filter((name) => name.startsWith(`${UNIT_PREFIX}${instanceId}-`));
  for (const name of names) {
    await command(SYSTEMCTL, ["--user", "stop", name]);
    await command(SYSTEMCTL, ["--user", "reset-failed", name]).catch(
      (caughtError: unknown) => {
        // A stopped unit that did not fail is already gone.
        logCaughtError("CliWorkerUnit", caughtError);
      },
    );
  }
  return names.length;
}

/**
 * Lists the ACP worker units that still run, without stopping any of them.
 *
 * @param command - Runs `systemctl`; defaults to a real process.
 * @returns The names of units that are active, starting or stopping.
 *
 * @remarks
 * Used by the periodic reservation check (PAGE-264), which only observes. A
 * failed or inactive unit holds no process; a unit that is stopping still may.
 */
export async function listRunningWorkerUnits(
  command: CliWorkerCommand = runCommand,
): Promise<ReadonlySet<string>> {
  const listed = await command(SYSTEMCTL, [
    "--user",
    "list-units",
    "--all",
    "--plain",
    "--no-legend",
    "--type=service",
    `${UNIT_PREFIX}*`,
  ]);
  const running = new Set<string>();
  for (const line of listed.stdout.split("\n")) {
    const [name = "", , active = ""] = line.trim().split(/\s+/u);
    if (
      name.startsWith(UNIT_PREFIX) &&
      [
        "active",
        "activating",
        "deactivating",
        "reloading",
        "refreshing",
      ].includes(active)
    )
      running.add(name);
  }
  return running;
}

/**
 * Whether a worker unit of one session still runs, without stopping it.
 *
 * @param instanceId - The tag of the session; its units carry it in their name.
 * @param command - Runs `systemctl`; defaults to a real process.
 * @throws When the service manager cannot be read; nothing is proven then.
 */
export async function hasRunningWorkerUnit(
  instanceId: string,
  command: CliWorkerCommand = runCommand,
): Promise<boolean> {
  const prefix = `${UNIT_PREFIX}${instanceId}-`;
  return [...(await listRunningWorkerUnits(command))].some((name) =>
    name.startsWith(prefix),
  );
}

/**
 * Stops every worker unit of one session and proves that none of them runs any more.
 *
 * @param instanceId - The tag of the session; its units carry it in their name.
 * @param command - Runs `systemctl`; defaults to a real process.
 * @returns How many units of the session still run after the stop.
 * @throws When the service manager cannot be read; nothing is proven then.
 *
 * @remarks
 * A chat worker always runs in its unit (PAGE-335), so a session whose units
 * are all inactive has no process left, also when it ended before its
 * process identity was recorded.
 */
export async function settleWorkerUnits(
  instanceId: string,
  command: CliWorkerCommand = runCommand,
): Promise<number> {
  await stopWorkerUnits(instanceId, command);
  const prefix = `${UNIT_PREFIX}${instanceId}-`;
  const running = await listRunningWorkerUnits(command);
  return [...running].filter((name) => name.startsWith(prefix)).length;
}

/**
 * Proves that the user's service manager starts a limited transient unit.
 *
 * @param command - Runs `systemd-run`; defaults to a real process.
 * @returns Whether a unit with every limit a worker gets starts and ends cleanly.
 */
export async function probeWorkerUnits(
  command: CliWorkerCommand = runCommand,
): Promise<boolean> {
  try {
    await command(SYSTEMD_RUN, [
      "--user",
      "--quiet",
      "--wait",
      "--expand-environment=no",
      `--unit=${UNIT_PREFIX}probe-${randomUUID()}`,
      `--slice=${UNIT_SLICE}`,
      "-p",
      "MemoryMax=32M",
      "-p",
      "TasksMax=8",
      "-p",
      "OOMPolicy=kill",
      "--",
      TRUE_BINARY,
    ]);
    return true;
  } catch (caughtError: unknown) {
    logCaughtError("CliWorkerUnit", caughtError);

    return false;
  }
}

/**
 * Starts every ACP worker in its own transient unit of the server account's
 * service manager, with hard limits for tasks, CPU and runtime and a memory
 * budget shared by all workers.
 *
 * @remarks
 * The slice of the units is a cgroup with that budget: the kernel ends a worker
 * when all workers together exceed it, and systemd records the reason, so
 * neither the gateway nor Pages meet the global OOM killer for it. The unit works the
 * same whether Pages runs as a system or a user service, because the
 * manager starts the process itself instead of moving one. Values travel
 * in a private environment file, never in an argument list, and the
 * variables of the manager itself, such as its bus or an SSH agent, are
 * removed. Pages reaches the worker through the passed standard streams.
 */
export class CliWorkerUnits {
  private readonly directory: string;
  private readonly command: CliWorkerCommand;
  private readonly probe: () => Promise<boolean>;
  private result: { readonly isWorking: boolean; readonly at: number } | null =
    null;
  private probing: Promise<boolean> | null = null;

  /**
   * Creates the units of one server process.
   *
   * @param directory - A private folder for the environment files, outside every worker's reach.
   * @param command - Runs `systemd-run` and `systemctl`; defaults to real processes.
   */
  public constructor(
    directory: string,
    command: CliWorkerCommand = runCommand,
  ) {
    this.directory = directory;
    this.command = command;
    this.probe = () => probeWorkerUnits(command);
  }

  /** Whether workers can start in limited units on this host; a positive answer is kept. */
  public async isAvailable(): Promise<boolean> {
    const { result } = this;
    if (
      result !== null &&
      (result.isWorking || Date.now() - result.at < RETRY_FAILED_PROBE_MS)
    )
      return result.isWorking;
    this.probing ??= this.runProbe();
    return this.probing;
  }

  /**
   * Wraps an (isolated) session request so it starts in a limited unit, after
   * setting the shared budget of the slice.
   *
   * @param request - The request as it would start without a unit.
   * @param instanceId - The tag of the session; the unit name carries it.
   * @returns The wrapped request and the handle of its unit.
   */
  public async wrap(
    request: CliSessionRequest,
    instanceId: string,
  ): Promise<{
    readonly request: CliSessionRequest;
    readonly unit: CliWorkerUnitHandle;
  }> {
    await this.limitSlice();
    const name = `${UNIT_PREFIX}${instanceId}-${randomBytes(4).toString("hex")}.service`;
    const environment = {
      ...createCliEnvironment(
        request.home,
        request.provider,
        request.toolFile ?? request.file,
      ),
      ...request.environment,
    };
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, `${name}.env`);
    await writeFile(
      file,
      `${Object.entries(environment)
        .map(([key, value]) => environmentLine(key, value))
        .join("\n")}\n`,
      { mode: 0o600, flag: "wx" },
    );
    const unset = await this.managerVariables(environment);
    const runtime =
      request.timeoutMs > 0
        ? Math.ceil(request.timeoutMs / 1000) + RUNTIME_GRACE_SECONDS
        : UNBOUNDED_RUNTIME_SECONDS;
    const unit = this.handle(name, file);
    return {
      unit,
      request: {
        ...request,
        file: SYSTEMD_RUN,
        toolFile: request.toolFile ?? request.file,
        environment: { ...request.environment, ...managerEnvironment() },
        arguments: [
          "--user",
          "--quiet",
          "--pipe",
          "--wait",
          "--expand-environment=no",
          `--unit=${name}`,
          `--slice=${UNIT_SLICE}`,
          ...unitProperties({ file, runtime, unset }),
          "--",
          request.file,
          ...request.arguments,
        ],
      },
    };
  }

  /** Repeats on every start, because a runtime property ends with the manager. */
  private async limitSlice(): Promise<void> {
    try {
      await this.command(SYSTEMCTL, [
        "--user",
        "set-property",
        "--runtime",
        UNIT_SLICE,
        `MemoryMax=${ACP_SLICE_LIMITS.memoryMax}`,
        `MemorySwapMax=${ACP_SLICE_LIMITS.memorySwapMax}`,
      ]);
    } catch (caughtError: unknown) {
      // A missing budget must not stop a run.
      logDiagnostic(
        "CliWorkerUnit",
        "warn",
        `The worker starts without the shared memory budget because ${UNIT_SLICE} could not be limited.`,
        caughtError,
      );
    }
  }

  private async managerVariables(
    environment: Readonly<Record<string, string>>,
  ): Promise<readonly string[]> {
    const listed = await this.command(SYSTEMCTL, [
      "--user",
      "show-environment",
    ]);
    return listed.stdout
      .split("\n")
      .map((line) => line.slice(0, line.indexOf("=")))
      .filter(
        (variable) =>
          /^[A-Za-z_][A-Za-z0-9_]*$/u.test(variable) &&
          !Object.hasOwn(environment, variable),
      );
  }

  private handle(name: string, file: string): CliWorkerUnitHandle {
    let isRemoved = false;
    const remove = (): void => {
      if (isRemoved) return;
      isRemoved = true;
      void rm(file, { force: true }).catch((caughtError: unknown) => {
        logCaughtError("CliWorkerUnit", caughtError);
      });
    };
    return {
      name,
      signal: (signal) => {
        void this.command(SYSTEMCTL, [
          "--user",
          "kill",
          `--signal=${signal}`,
          "--kill-whom=all",
          name,
        ]).catch((caughtError: unknown) => {
          // A unit that already ended has nothing left to signal.
          logCaughtError("CliWorkerUnit", caughtError);
        });
      },
      started: remove,
      settle: () => this.settle(name, file),
    };
  }

  private async settle(
    name: string,
    file: string,
  ): Promise<CliWorkerUnitResult> {
    await rm(file, { force: true });
    let result: CliWorkerUnitResult = "unknown";
    try {
      // systemd unloads a unit at once only when it ended cleanly; a failed one keeps its result.
      if ((await this.unitState(name, "LoadState")) === "not-found")
        result = "success";
      else {
        // Stopping first ends a helper that outlived the adapter.
        await this.command(SYSTEMCTL, ["--user", "stop", name]);
        // The end of the session counts as its process frame's end only once nothing of the unit runs.
        const active = await this.unitState(name, "ActiveState");
        if (active !== "inactive" && active !== "failed")
          throw new Error("The worker unit did not stop");
        result = readResult(await this.unitState(name, "Result"));
      }
    } finally {
      await this.command(SYSTEMCTL, ["--user", "reset-failed", name]).catch(
        (caughtError: unknown) => {
          // Only a failed unit stays loaded; a clean one is gone already.
          logCaughtError("CliWorkerUnit", caughtError);
        },
      );
    }
    logEvent({
      level: result === "success" || result === "exit-code" ? "info" : "warn",
      event: "cli.worker.ended",
      component: "CliWorkerUnit",
      message: "ACP worker unit ended",
      metadata: { unit: name, result },
    });
    return result;
  }

  private async unitState(
    name: string,
    property: "LoadState" | "ActiveState" | "Result",
  ): Promise<string> {
    const shown = await this.command(SYSTEMCTL, [
      "--user",
      "show",
      `--property=${property}`,
      "--value",
      name,
    ]);
    return shown.stdout.trim();
  }

  private async runProbe(): Promise<boolean> {
    try {
      // Files of a server that ended abruptly still hold the values of its workers.
      if (this.result === null)
        await rm(this.directory, { recursive: true, force: true });
      const isWorking = await this.probe();
      this.result = { isWorking, at: Date.now() };
      return isWorking;
    } finally {
      this.probing = null;
    }
  }
}

function unitProperties(terms: {
  readonly file: string;
  readonly runtime: number;
  readonly unset: readonly string[];
}): readonly string[] {
  const properties = [
    `MemoryMax=${ACP_WORKER_LIMITS.memoryMax}`,
    `MemorySwapMax=${ACP_WORKER_LIMITS.memorySwapMax}`,
    `TasksMax=${ACP_WORKER_LIMITS.tasksMax}`,
    `CPUQuota=${ACP_WORKER_LIMITS.cpuQuota}`,
    `OOMScoreAdjust=${ACP_WORKER_LIMITS.oomScoreAdjust}`,
    "OOMPolicy=kill",
    `RuntimeMaxSec=${terms.runtime}`,
    // Pages already waited for a graceful end before it stops a unit.
    "TimeoutStopSec=5s",
    "UMask=0077",
    `EnvironmentFile=${terms.file}`,
    ...(terms.unset.length > 0
      ? [`UnsetEnvironment=${terms.unset.join(" ")}`]
      : []),
  ];
  return properties.flatMap((property) => ["-p", property]);
}
