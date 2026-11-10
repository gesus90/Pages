import { chmod, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import type { RunnerJob } from "./runner-execution-claim-harness";
import {
  installClaimHooks,
  mocks,
  JOB_ID,
  state,
  loadExecution,
  makeJob,
  makeChild,
  readJson,
  writeJson,
} from "./runner-execution-claim-harness";

installClaimHooks();

it.each([
  ["a malformed job id", makeJob({ jobId: "not-a-uuid" })],
  ["a missing plan", { ...makeJob(), plan: undefined } as unknown as RunnerJob],
  ["an unknown execution version", makeJob({ execution: { version: 2 } })],
])("refuses a dispatch with %s", async (label, job) => {
  const { claimJob } = await loadExecution();

  await expect(claimJob(state.directory, job)).rejects.toThrow(
    "Invalid dispatch",
  );
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("never spawns a second time when the claim folder already exists", async () => {
  await mkdir(state.folder, { recursive: true });
  const { claimJob } = await loadExecution();

  await claimJob(state.directory, makeJob());

  expect(mocks.spawn).not.toHaveBeenCalled();
  await expect(
    readFile(path.join(state.folder, "claim.json")),
  ).rejects.toThrow();
});

it("rethrows a folder creation failure that is not a duplicate claim", async () => {
  await mkdir(path.join(state.directory, "jobs"), { mode: 0o500 });
  const { claimJob } = await loadExecution();

  try {
    await expect(claimJob(state.directory, makeJob())).rejects.toMatchObject({
      code: "EACCES",
    });
  } finally {
    await chmod(path.join(state.directory, "jobs"), 0o700);
  }
});

it.each([
  ["a job that already carries a launch", { launch: { id: "x" } }, null],
  ["a job that is no longer queued", { status: "running" }, null],
  ["a job whose protected launch evidence exists", {}, { boundary: "x" }],
])(
  "stores the claim but starts no worker for %s",
  async (label, extra, owned) => {
    if (owned) {
      await writeJson(
        path.join(state.directory, "ownership", `${JOB_ID}.json`),
        owned,
      );
    }
    const job = makeJob(extra);
    const { claimJob } = await loadExecution();

    await claimJob(state.directory, job);

    expect(await readJson(path.join(state.folder, "claim.json"))).toMatchObject(
      {
        jobId: JOB_ID,
      },
    );
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.rememberOwnership).not.toHaveBeenCalled();
  },
);

it("ends a job that was stopped during admission without a worker", async () => {
  mocks.cancellationFor.mockResolvedValue({ reason: "stop" });
  const { claimJob } = await loadExecution();

  await claimJob(state.directory, makeJob());

  expect(mocks.rememberOwnership).toHaveBeenCalledWith(state.folder);
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(
    await readJson(path.join(state.directory, "ownership", `${JOB_ID}.json`)),
  ).toEqual({
    boundary: "not_started",
    jobId: JOB_ID,
    sessionId: "session-1",
    attemptId: "attempt-1",
  });
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
});

it("refuses an ownership directory that others may enter", async () => {
  await mkdir(path.join(state.directory, "ownership"), { mode: 0o755 });
  await chmod(path.join(state.directory, "ownership"), 0o755);
  const { claimJob } = await loadExecution();

  await expect(claimJob(state.directory, makeJob())).rejects.toThrow(
    "Invalid runner ownership directory",
  );
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("starts a script worker in a bubblewrap PID namespace and releases it", async () => {
  process.env.PAGES_RUNNER_CLI_HOME = "/synthetic/home";
  process.env.PAGES_RUNNER_ANTIGRAVITY_HOME = "/synthetic/antigravity";
  process.env.PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT = "/synthetic/context";
  const { claimJob } = await loadExecution();

  await claimJob(state.directory, makeJob());

  expect(mocks.spawn).toHaveBeenCalledTimes(1);
  const [program, args, options] = mocks.spawn.mock.calls[0] as [
    string,
    string[],
    { env: Record<string, string>; detached: boolean; stdio: unknown[] },
  ];
  expect(program).toBe("/usr/bin/bwrap");
  expect(args).toContain("--unshare-pid");
  expect(args.slice(-2)).toEqual(["--job", state.folder]);
  expect(options.detached).toBe(true);
  expect(options.env).toMatchObject({
    HOME: state.directory,
    PAGES_REMOTE_JOB: JOB_ID,
    PAGES_RUNNER_CLI_HOME: "/synthetic/home",
    PAGES_RUNNER_JOB_NAMESPACE: "1",
    PAGES_RUNNER_CONTEXT_PROOF: "[]",
    PAGES_RUNNER_HOST_TASKS: "77",
    PAGES_RUNNER_ANTIGRAVITY_HOME: "/synthetic/antigravity",
    PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT: "/synthetic/context",
  });
  const launch = (await readJson(path.join(state.folder, "launch.json"))) as {
    boundary: string;
    processId: number;
    identity: string;
    parentNamespace: string;
  };
  expect(launch).toMatchObject({
    boundary: "pid_namespace",
    processId: 4242,
    identity: "boot:99",
  });
  expect(launch.parentNamespace).toMatch(/^pid:\[\d+\]$/);
  expect(
    await readJson(path.join(state.directory, "ownership", `${JOB_ID}.json`)),
  ).toEqual(launch);
  expect(state.children[0].stdin.end).toHaveBeenCalledWith("go\n");
  expect(state.children[0].unref).toHaveBeenCalled();
  expect(mocks.antigravityContextProof).not.toHaveBeenCalled();
});

it("passes the Antigravity context proof and no host task count to a CLI worker", async () => {
  delete process.env.PAGES_RUNNER_ANTIGRAVITY_HOME;
  delete process.env.PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT;
  delete process.env.PAGES_RUNNER_CLI_HOME;
  const { claimJob } = await loadExecution();

  await claimJob(
    state.directory,
    makeJob({
      execution: {
        version: 1,
        program: { kind: "cli", route: { tool: "antigravity" } },
      },
    }),
  );

  const options = mocks.spawn.mock.calls[0][2] as {
    env: Record<string, string>;
  };
  expect(options.env.PAGES_RUNNER_CONTEXT_PROOF).toBe('["proof"]');
  expect(options.env.PAGES_RUNNER_CLI_HOME).toBe(os.homedir());
  expect(options.env).not.toHaveProperty("PAGES_RUNNER_HOST_TASKS");
  expect(options.env).not.toHaveProperty("PAGES_RUNNER_ANTIGRAVITY_HOME");
  expect(mocks.accountTasks).not.toHaveBeenCalled();
});

it("does not read the Antigravity proof for another CLI tool", async () => {
  const { claimJob } = await loadExecution();

  await claimJob(
    state.directory,
    makeJob({
      execution: {
        version: 1,
        program: { kind: "cli", route: { tool: "codex" } },
      },
    }),
  );

  expect(mocks.antigravityContextProof).not.toHaveBeenCalled();
  const options = mocks.spawn.mock.calls[0][2] as {
    env: Record<string, string>;
  };
  expect(options.env.PAGES_RUNNER_CONTEXT_PROOF).toBe("[]");
});

it("destroys the pipe and reports a supervisor that did not start", async () => {
  mocks.spawn.mockImplementation(() => makeChild(undefined));
  const { claimJob } = await loadExecution();

  await expect(claimJob(state.directory, makeJob())).rejects.toThrow(
    "Runner supervisor did not start",
  );

  expect(state.children[0].stdin.end).not.toHaveBeenCalled();
  await expect(
    readFile(path.join(state.folder, "launch.json")),
  ).rejects.toThrow();
  // The spawn error handler keeps the process alive; the claim reconciles later.
  expect(() =>
    state.children[0].emit("error", new Error("ENOENT")),
  ).not.toThrow();
  expect(() =>
    state.children[0].stdin.emit("error", new Error("EPIPE")),
  ).not.toThrow();
});

it("fails when the identity of the supervisor cannot be read", async () => {
  mocks.identity.mockResolvedValue(null);
  const { claimJob } = await loadExecution();

  await expect(claimJob(state.directory, makeJob())).rejects.toThrow(
    "Runner supervisor identity unavailable",
  );

  expect(state.children[0].stdin.end).not.toHaveBeenCalled();
  expect(state.children[0].unref).not.toHaveBeenCalled();
});
