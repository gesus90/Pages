import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";

import { CliSessionProcess } from "../../../backend/agents/cli/CliSessionProcess";

const PROGRAM = `
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const file = process.argv[1];
spawn(process.execPath, ['-e', "setInterval(() => require('node:fs').appendFileSync(process.argv[1], 'c'), 20)", file], { stdio: 'ignore' });
setInterval(() => fs.appendFileSync(file, 'p'), 20);
`;

/** Exercises real owned parent/child processes without a provider, database or shared service. */
async function probe(): Promise<void> {
  const directory = await mkdtemp("/tmp/pages-page361-process-");
  const file = path.join(directory, "heartbeat");
  const child = spawn(process.execPath, ["-e", PROGRAM, file], {
    cwd: directory,
    detached: true,
    env: { PATH: "/usr/bin:/bin", HOME: directory },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const controller = new AbortController();
  const session = new CliSessionProcess(
    child,
    {
      timeoutMs: 30_000,
      signal: controller.signal,
      onLine: () => undefined,
    },
    (pid, signal) => process.kill(pid, signal),
  );
  const latencies: number[] = [];
  try {
    await wait(300);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const started = Date.now();
      await session.setPaused(true);
      latencies.push(Date.now() - started);
      if (!child.stdin?.writable) throw new Error("paused_stdin_closed");
      const frozen = await readFile(file, "utf8");
      await wait(150);
      if ((await readFile(file, "utf8")) !== frozen)
        throw new Error("paused_children_still_writing");
      if (cycle < 2) {
        await session.setPaused(false);
        await wait(100);
        if ((await stat(file)).size <= frozen.length)
          throw new Error("resume_did_not_continue");
      }
    }
    const stopped = Date.now();
    controller.abort();
    await session.exited;
    const stopMilliseconds = Date.now() - stopped;
    const stoppedHeartbeat = await readFile(file, "utf8");
    await wait(100);
    if ((await readFile(file, "utf8")) !== stoppedHeartbeat)
      throw new Error("stopped_child_still_writing");
    console.info(
      JSON.stringify({
        pauseMilliseconds: latencies,
        stopMilliseconds,
        preservedPipes: true,
        cycles: 3,
        providerCalls: 0,
      }),
    );
  } finally {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      process.kill(-child.pid, "SIGKILL");
      await session.exited;
    }
    await rm(directory, { recursive: true, force: true });
    console.info(JSON.stringify({ removed: true }));
  }
}

await probe();
