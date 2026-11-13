import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { localManagerEnvironment } from "@/backend/agents/local/LocalSessionOwnership";

import { hasEndedOwnedNamespace } from "./CliOwnedNamespace";

import type { AcpNamespaceOwner } from "@/definition/AcpResource";

const runFile = promisify(execFile);

async function descendants(
  pid: number,
  shouldSuspend: boolean,
): Promise<number[]> {
  const result = [pid];
  for (let index = 0; index < result.length; index += 1) {
    const parent = result[index];
    try {
      if (shouldSuspend && parent !== undefined)
        process.kill(parent, "SIGSTOP");
      const children = await readFile(
        `/proc/${parent}/task/${parent}/children`,
        "utf8",
      );
      for (const child of children.trim().split(/\s+/u).map(Number))
        if (child > 0 && !result.includes(child)) result.push(child);
    } catch (error: unknown) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
  }
  return result;
}

/** Controls only an identity-checked owned namespace, including its child processes. */
export async function controlOwnedNamespace(
  owner: AcpNamespaceOwner,
  action: "pause" | "resume" | "stop",
): Promise<void> {
  if (await hasEndedOwnedNamespace(owner)) return;
  if (owner.unit) {
    await runFile(
      "/usr/bin/systemctl",
      ["--user", action === "pause" ? "freeze" : "thaw", owner.unit],
      {
        env: localManagerEnvironment(),
        timeout: 2000,
      },
    );
    if (action === "stop")
      await runFile(
        "/usr/bin/systemctl",
        ["--user", "kill", "--signal=SIGKILL", "--kill-whom=all", owner.unit],
        {
          env: localManagerEnvironment(),
          timeout: 2000,
        },
      );
    return;
  }
  // Stop the supervisor first: it cannot fork while its descendants are collected.
  const processes = await descendants(owner.pid, action === "pause");
  for (const pid of processes.reverse()) {
    try {
      process.kill(
        pid,
        action === "pause"
          ? "SIGSTOP"
          : action === "resume"
            ? "SIGCONT"
            : "SIGKILL",
      );
    } catch (error: unknown) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ESRCH"
      ))
        throw error;
    }
  }
}
