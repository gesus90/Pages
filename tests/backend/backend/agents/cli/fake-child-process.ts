import { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";

import { vi } from "vitest";

import type { Mock } from "vitest";

/** A child with piped streams that never runs a real process. */
export interface FakeChild {
  readonly child: ChildProcess;
  readonly stdin: PassThrough;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly kill: Mock<(signal?: NodeJS.Signals) => boolean>;
}

/**
 * Creates an unspawned child process with in-memory pipes.
 *
 * @param processId - The process group the child reports; `null` for a failed spawn.
 * @returns The child, its pipes and its direct kill.
 */
export function fakeChild(processId: number | null = 77): FakeChild {
  const child = new ChildProcess();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.defineProperty(child, "stdin", { value: stdin });
  Object.defineProperty(child, "stdout", { value: stdout });
  Object.defineProperty(child, "stderr", { value: stderr });
  Object.defineProperty(child, "pid", { value: processId ?? undefined });
  const kill = vi.fn<(signal?: NodeJS.Signals) => boolean>(() => true);
  Object.defineProperty(child, "kill", { value: kill });
  return { child, stdin, stdout, stderr, kill };
}
