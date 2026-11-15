import { readFile } from "node:fs/promises";

import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

/** Reads when the running kernel booted, from `btime` of `/proc/stat`. */
export async function readBootTime(root = "/proc"): Promise<number> {
  const text = await readFile(`${root}/stat`, "utf8");
  const line = text.split("\n").find((entry) => entry.startsWith("btime "));
  const seconds = Number(line?.slice("btime ".length).trim());
  if (!Number.isSafeInteger(seconds) || seconds <= 0)
    throw new Error("Boot time unavailable");
  return seconds * 1000;
}

/** Every start an attempt of this step recorded; empty when none is known. */
function attemptStarts(step: AgentPlanStepResult): readonly (string | null)[] {
  return [step.script?.startedAt ?? null, step.session?.startedAt ?? null];
}

/** Whether a step may own a process whose start is unknown. */
function hasUnknownStart(step: AgentPlanStepResult): boolean {
  return (
    (step.script !== undefined || (step.session ?? null) !== null) &&
    attemptStarts(step).every((start) => start === null)
  );
}

/**
 * Whether every local process the run could own started before the current boot.
 *
 * @param run - An ended run whose cleanup is to be proven.
 * @param bootTime - When the running kernel booted, in epoch milliseconds.
 * @returns `true` only for an ended, purely local run with known starts.
 *
 * @remarks
 * No process survives a reboot. A run whose every attempt started before the
 * boot therefore cannot own a process any more, also when its records lack a
 * namespace or its scan was never possible. Remote work runs on another host,
 * an active run may still dispatch, and a step without any recorded start may
 * have started after the boot; each of them keeps the full check.
 */
export function predatesBoot(run: AgentPlanRun, bootTime: number): boolean {
  if (isActivePlanRun(run.status)) return false;
  const steps = allPlanRunResults(run);
  if (
    steps.some(
      (step) => step.execution?.target.kind === "remote" || step.remote,
    ) ||
    steps.some(hasUnknownStart)
  )
    return false;
  const starts = [
    run.startedAt,
    ...steps.flatMap(attemptStarts),
    ...(run.loops ?? []).flatMap((loop) => [
      loop.startedAt,
      ...loop.iterations.map((iteration) => iteration.startedAt),
    ]),
  ].filter((start): start is string => start !== null);
  return starts.every((start) => {
    const time = Date.parse(start);
    return Number.isFinite(time) && time < bootTime;
  });
}

/**
 * Whether the run's processes provably ended with a reboot; a failed read proves nothing.
 *
 * @param run - An ended run whose cleanup is to be proven.
 * @param bootTime - Reads the current boot time; replaceable for tests.
 */
export async function hasEndedWithReboot(
  run: AgentPlanRun,
  bootTime: () => Promise<number> = readBootTime,
): Promise<boolean> {
  if (isActivePlanRun(run.status)) return false;
  try {
    return predatesBoot(run, await bootTime());
  } catch (error: unknown) {
    logCaughtError("AgentPlanBootBoundary", error);
    return false;
  }
}
