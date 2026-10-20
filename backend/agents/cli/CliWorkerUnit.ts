import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { logCaughtError, logEvent } from "@/backend/logging/Logger";

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
 * The hard limits of one ACP worker: adapter, runner, MCP bridge and every
 * helper they start, counted together in the cgroup of its unit.
 *
 * @remarks
 * Measured on the N100 / 8 GiB installation (PAGE-127, 93 workers): a Codex
 * or Claude Code worker with its MCP bridge peaked at 430 MiB and 100 tasks,
 * an OpenCode worker at 810 MiB and 22 tasks. The memory ceiling leaves
 * room for a larger turn while two workers together stay far below what the
 * host can lose without pushing the gateway or Pages into the kernel's global
 * OOM killer. Swap is capped so a growing worker fails itself instead of slowing
 * the host down; CPU stays below half of the four cores.
 */
export const ACP_WORKER_LIMITS = {
  memoryMax: "1536M",
  memorySwapMax: "256M",
  tasksMax: 512,
  cpuQuota: "200%",
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
 * service manager, with hard limits for memory, swap, tasks, CPU and runtime.
 *
 * @remarks
 * A unit is a cgroup of its own: the kernel ends a worker that exceeds its
 * memory inside that cgroup, and systemd records the reason, so neither the
 * gateway nor Pages meet the global OOM killer for it. The unit works the
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
   * Wraps an (isolated) session request so it starts in a limited unit.
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
    property: "LoadState" | "Result",
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
