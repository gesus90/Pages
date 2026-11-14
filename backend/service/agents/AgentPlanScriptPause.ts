import { SerialQueue } from "@/backend/concurrency/SerialQueue";

import { setNamespacePaused } from "@/backend/agents/cli/CliNamespacePause";

import type { CliPausableDeadline } from "@/backend/agents/cli/CliPausableDeadline";
import type { AcpNamespaceOwner } from "@/definition/AcpResource";

interface ScriptPauseControl {
  readonly setPaused: (isPaused: boolean) => Promise<void>;
}

const pausedRuns = new Set<string>();
const processes = new Map<string, Set<ScriptPauseControl>>();

/** Freezes every script of a run, including a script still waiting for its spawn gate. */
export async function setScriptRunPaused(
  runId: string,
  isPaused: boolean,
): Promise<void> {
  if (isPaused) pausedRuns.add(runId);
  else pausedRuns.delete(runId);
  await Promise.all(
    [...(processes.get(runId) ?? [])].map((entry) => entry.setPaused(isPaused)),
  );
}

/** Registers the owned supervisor before releasing its launch pipe. */
export async function registerScriptPause(input: {
  readonly runId: string;
  readonly namespace: AcpNamespaceOwner;
  readonly deadline: CliPausableDeadline;
}): Promise<() => void> {
  const { runId, namespace, deadline } = input;
  const changes = new SerialQueue();
  const control: ScriptPauseControl = {
    setPaused: (isPaused) =>
      changes.run(async () => {
        if (isPaused) deadline.pause();
        try {
          await setNamespacePaused(namespace, isPaused);
        } catch (error: unknown) {
          if (isPaused) deadline.resume();
          throw error;
        }
        if (!isPaused) deadline.resume();
      }),
  };
  const entries = processes.get(runId) ?? new Set<ScriptPauseControl>();
  entries.add(control);
  processes.set(runId, entries);
  try {
    if (pausedRuns.has(runId)) await control.setPaused(true);
  } catch (error: unknown) {
    entries.delete(control);
    throw error;
  }
  return () => {
    entries.delete(control);
    if (entries.size === 0) processes.delete(runId);
  };
}

/** Discards only the in-memory launch gate once every process of a run has settled. */
export function forgetScriptRunPause(runId: string): void {
  pausedRuns.delete(runId);
}

/** Whether a run still owns frozen script processes. */
export function isScriptRunPaused(runId: string): boolean {
  return pausedRuns.has(runId);
}
