import { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";

import { vi } from "vitest";

import type { CliHome, CliSpawn } from "@/backend/agents/cli/CliContracts";

export const CLI_HOME: CliHome = {
  root: "/test/agents/00000000-0000-4000-8000-000000000001",
  home: "/test/agents/00000000-0000-4000-8000-000000000001/home",
  config: "/test/agents/00000000-0000-4000-8000-000000000001/codex",
  work: "/test/agents/00000000-0000-4000-8000-000000000001/work",
};

/** Simulates child streams and events without executing any installed CLI. */
export function createCliSpawn() {
  const children: ChildProcess[] = [];
  const spawn = vi.fn<CliSpawn>((_, args, options) => {
    const child = new ChildProcess();
    Object.defineProperty(child, "pid", {
      value: 42000 + children.length,
      configurable: true,
    });
    child.stdin =
      Array.isArray(options.stdio) && options.stdio[0] === "pipe"
        ? new PassThrough()
        : null;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    vi.spyOn(child, "kill").mockReturnValue(true);
    Object.defineProperty(child, "spawnargs", { value: [...args] });
    children.push(child);
    return child;
  });
  return { spawn, children, signalGroup: vi.fn() };
}

/** Delivers synthetic output, then closes the fake child's pipes and process. */
export function completeCli(
  child: ChildProcess,
  output = "",
  exitCode: number | null = 0,
  stderr = "",
): void {
  child.stdout?.emit("data", output);
  child.stderr?.emit("data", stderr);
  child.emit("close", exitCode);
}
