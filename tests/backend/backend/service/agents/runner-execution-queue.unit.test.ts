import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, it } from "vitest";

import {
  installClaimHooks,
  mocks,
  JOB_ID,
  state,
  loadExecution,
  makeJob,
  makeChild,
  readJson,
} from "./runner-execution-claim-harness";

installClaimHooks();

it("queues a cancelled job as interrupted without a worker", async () => {
  const { cancelQueuedJob } = await loadExecution();

  await cancelQueuedJob(state.directory, makeJob());

  expect(await readJson(path.join(state.folder, "claim.json"))).toMatchObject({
    jobId: JOB_ID,
  });
  expect(
    await readJson(path.join(state.directory, "ownership", `${JOB_ID}.json`)),
  ).toEqual({ boundary: "not_started" });
  expect(await readJson(path.join(state.folder, "result.json"))).toEqual({
    status: "interrupted",
    result: {
      output: null,
      closeout: "confirmed",
      exitCode: null,
      signal: null,
      reason: "cancelled",
    },
  });
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("fails a refused queued job with a named reason and a default code", async () => {
  const { refuseQueuedJob } = await loadExecution();

  await refuseQueuedJob(state.directory, makeJob());

  expect(await readJson(path.join(state.folder, "result.json"))).toEqual({
    status: "failed",
    result: {
      output: null,
      closeout: "confirmed",
      exitCode: null,
      signal: null,
      reason: "spawn",
      failureCode: "plan_runner_admission_failed",
    },
  });
});

it("keeps an explicit refusal code and does not overwrite an existing end", async () => {
  const { refuseQueuedJob, cancelQueuedJob } = await loadExecution();

  await refuseQueuedJob(state.directory, makeJob(), "plan_runner_full");
  await cancelQueuedJob(state.directory, makeJob());

  expect(await readJson(path.join(state.folder, "result.json"))).toMatchObject({
    status: "failed",
    result: { failureCode: "plan_runner_full" },
  });
});

it("rethrows a failure to create the folder of a queued job end", async () => {
  await mkdir(path.join(state.directory, "jobs"), { mode: 0o500 });
  const { cancelQueuedJob } = await loadExecution();

  try {
    await expect(
      cancelQueuedJob(state.directory, makeJob()),
    ).rejects.toMatchObject({
      code: "EACCES",
    });
  } finally {
    await chmod(path.join(state.directory, "jobs"), 0o700);
  }
});

it("proves the PID namespace once and remembers only the success", async () => {
  mocks.spawn.mockImplementation(() => {
    const probe = makeChild(1);
    queueMicrotask(() => probe.emit("close", 0));
    return probe;
  });
  const { canIsolateJobs } = await loadExecution();

  expect(await canIsolateJobs()).toBe(true);
  expect(await canIsolateJobs()).toBe(true);

  expect(mocks.spawn).toHaveBeenCalledTimes(1);
  const [program, args, options] = mocks.spawn.mock.calls[0] as [
    string,
    string[],
    { timeout: number; stdio: string },
  ];
  expect(program).toBe("/usr/bin/bwrap");
  expect(args).toContain("--unshare-pid");
  expect(options).toEqual({ stdio: "ignore", timeout: 10000 });
});

it("retries the namespace probe after a failing exit and a spawn error", async () => {
  const outcomes = ["exit", "error", "ok"] as const;
  let call = 0;
  mocks.spawn.mockImplementation(() => {
    const probe = makeChild(1);
    const outcome = outcomes[call++];
    queueMicrotask(() => {
      if (outcome === "exit") probe.emit("close", 1);
      else if (outcome === "error") probe.emit("error", new Error("ENOENT"));
      else probe.emit("close", 0);
    });
    return probe;
  });
  const { canIsolateJobs } = await loadExecution();

  expect(await canIsolateJobs()).toBe(false);
  expect(await canIsolateJobs()).toBe(false);
  expect(await canIsolateJobs()).toBe(true);
  expect(mocks.spawn).toHaveBeenCalledTimes(3);
});
