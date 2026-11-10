import { readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, it, vi } from "vitest";

import type { FakeOutput } from "./runner-execution-worker-harness";
import {
  installWorkerHooks,
  mocks,
  JOB_ID,
  SCRIPT_PATH,
  state,
  scriptCommand,
  runWorker,
  storedResult,
} from "./runner-execution-worker-harness";

installWorkerHooks();

it("runs no worker code when the module is imported without --job", async () => {
  process.argv = [process.argv[0], "vitest"];
  vi.resetModules();

  await import(SCRIPT_PATH);

  expect(mocks.spawn).not.toHaveBeenCalled();
  await expect(
    readFile(path.join(state.folder, "result.json")),
  ).rejects.toThrow();
});

it("refuses a job folder that is a symbolic link", async () => {
  const link = path.join(state.privateRoot, "linked");
  await symlink(state.folder, link);
  process.argv = [process.argv[0], "vitest", "--job", link];
  vi.resetModules();

  await expect(import(SCRIPT_PATH)).rejects.toThrow("Invalid worker owner");
});

it("refuses a job path that is no directory", async () => {
  const file = path.join(state.privateRoot, "plain");
  await writeFile(file, "x");
  process.argv = [process.argv[0], "vitest", "--job", file];
  vi.resetModules();

  await expect(import(SCRIPT_PATH)).rejects.toThrow("Invalid worker owner");
});

it("refuses a worker that was not released with the exact signal", async () => {
  await expect(runWorker({ release: "no\n" })).rejects.toThrow(
    "Worker was not released",
  );
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("refuses an over-long release before reading further", async () => {
  await expect(runWorker({ release: "x".repeat(17) })).rejects.toThrow(
    "Invalid worker release",
  );
});

it.each([
  ["no launch record", null],
  ["a launch outside the PID namespace", { boundary: "not_started" }],
])("refuses to run with %s", async (label, launch) => {
  await expect(runWorker({ launch })).rejects.toThrow(
    "Worker ownership unavailable",
  );
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("runs a Node script under resource limits and records a completed result", async () => {
  await runWorker();

  expect(mocks.spawn).toHaveBeenCalledTimes(1);
  const [program, args, options] = mocks.spawn.mock.calls[0] as [
    string,
    string[],
    { cwd: string; env: Record<string, string> },
  ];
  expect(program).toBe("/usr/bin/prlimit");
  expect(args).toEqual([
    "--cpu=6",
    `--nproc=${77 + 256}`,
    "--nofile=128",
    "--fsize=10485760",
    "--core=0",
    "--as=1073741824",
    "--",
    "/usr/bin/node",
    "--jitless",
    "--max-old-space-size=128",
    path.join(state.folder, "runtime", "node-guard.cjs"),
  ]);
  expect(options.cwd).toBe(state.workspace);
  expect(options.env).toMatchObject({
    PAGES_REMOTE_JOB: JOB_ID,
    HOME: path.join(state.folder, "runtime"),
  });
  expect(
    await readFile(path.join(state.folder, "runtime", "source.cjs"), "utf8"),
  ).toBe("console.log(1)");
  expect(
    await readFile(
      path.join(state.folder, "runtime", "node-guard.cjs"),
      "utf8",
    ),
  ).toContain('require("./source.cjs")');
  expect(state.children[0].stdin.end).toHaveBeenCalledWith("input-bytes");
  expect(
    JSON.parse(await readFile(path.join(state.folder, "child.json"), "utf8")),
  ).toEqual({ processId: 5151, identity: "boot:77" });
  expect(await storedResult()).toEqual({
    status: "completed",
    result: {
      exitCode: 0,
      signal: null,
      reason: null,
      output: "script-output",
      stderr: "",
      closeout: "confirmed",
    },
  });
  expect(mocks.notifyJobCompletion).toHaveBeenCalledWith(
    state.privateRoot,
    JOB_ID,
  );
  const output = mocks.outputs[0] as FakeOutput;
  expect(output.end).toHaveBeenCalled();
  expect(output.close).toHaveBeenCalled();
});

it("runs another interpreter directly with a smaller address space", async () => {
  const command = scriptCommand({
    program: {
      kind: "script",
      source: "print(1)",
      interpreter: {
        id: "python",
        path: "/usr/bin/python3",
        digest: "digest-2",
      },
    },
  });

  await runWorker({ command });

  const args = mocks.spawn.mock.calls[0][1] as string[];
  expect(args).toContain("--as=536870912");
  expect(args.slice(-2)).toEqual([
    "/usr/bin/python3",
    path.join(state.folder, "runtime", "source.cjs"),
  ]);
  await expect(
    readFile(path.join(state.folder, "runtime", "node-guard.cjs")),
  ).rejects.toThrow();
  expect((await storedResult()).status).toBe("completed");
});

it("fails a script when the host task count is not a count", async () => {
  process.env.PAGES_RUNNER_HOST_TASKS = "many";

  await runWorker();

  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(await storedResult()).toMatchObject({
    status: "failed",
    result: { exitCode: null, output: null, reason: "spawn" },
  });
});

it("hands the secrets of the private root to the redaction of output", async () => {
  await runWorker({
    files: {
      "config.json": { token: "runner-token-value" },
      "openrouter.json": { apiKey: "router-key-value" },
    },
  });

  const redact = (mocks.outputs[0] as FakeOutput).constructorArguments[3] as (
    text: string,
  ) => string;
  expect(redact("a runner-token-value b router-key-value c")).toBe(
    "a [redacted] b [redacted] c",
  );
  expect(redact("plain text")).toBe("plain text");
  expect(
    redact(
      "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
    ),
  ).toBe("[redacted]");
  expect(redact("-----BEGIN PRIVATE KEY-----\nunterminated")).toBe(
    "[redacted]",
  );
  expect(redact("jwt eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl end")).toBe(
    "jwt [redacted] end",
  );
  expect(redact('refresh_token: "abc123" next')).toBe(
    'refresh_token: "[redacted]" next',
  );
  expect(redact("Authorization: Bearer abc.def")).toBe(
    "Authorization: [redacted]",
  );
  expect(redact("key sk-abcdefghijklmnop and ghp_abcdefghijkl")).toBe(
    "key [redacted] and [redacted]",
  );
  expect(redact("password=hunter2 ok")).toBe("[redacted] ok");
});

it.each([
  ["a non-zero exit", [3, null], "failed", "exit"],
  ["a killed process", [null, "SIGKILL"], "lost", "lost"],
] as const)("records %s", async (label, exit, status, reason) => {
  await runWorker({ exit: [...exit] as [number | null, string | null] });

  expect(await storedResult()).toMatchObject({
    status,
    result: { reason, closeout: "confirmed" },
  });
});

it("does not report completion when the closeout is not confirmed", async () => {
  mocks.cleanup.mockResolvedValue("failed");

  await runWorker();

  expect(await storedResult()).toMatchObject({
    status: "failed",
    result: { exitCode: 0, closeout: "failed" },
  });
});

it("adds the stable failure code of a session that broke off", async () => {
  await runWorker({
    onInput: ({ output }) => output.sessionFailure.mockReturnValue("quota"),
  });

  const stored = await storedResult();
  expect(stored.result.failureCode).toBe("quota");
  expect((mocks.outputs[0] as FakeOutput).sessionFailure).toHaveBeenCalledWith({
    isStopped: false,
    exitCode: 0,
    signal: null,
  });
});

it("keeps a failure code the output already decided", async () => {
  mocks.outputResult.current = { output: null, failureCode: "own_code" };

  await runWorker({
    onInput: ({ output }) => output.sessionFailure.mockReturnValue("other"),
  });

  expect((await storedResult()).result.failureCode).toBe("own_code");
  expect(
    (mocks.outputs[0] as FakeOutput).sessionFailure,
  ).not.toHaveBeenCalled();
});

it("takes the reason of the final output when the process ended cleanly", async () => {
  mocks.outputResult.current = { output: null, reason: "result_limit" };

  await runWorker({ exit: [0, null] });

  expect(await storedResult()).toMatchObject({
    status: "failed",
    result: { exitCode: 0, reason: "result_limit" },
  });
});

it("pauses both pipes while the output is full and resumes them on drain", async () => {
  await runWorker({
    onInput: ({ child, output }) => {
      output.write.mockReturnValueOnce(false);
      child.stdout.emit("data", Buffer.from("out"));
      child.stderr.emit("data", Buffer.from("err"));
      output.emit("drain");
    },
  });

  const { child } = { child: state.children[0] };
  const output = mocks.outputs[0] as FakeOutput;
  expect(output.write).toHaveBeenNthCalledWith(1, {
    chunk: Buffer.from("out"),
    channel: "stdout",
  });
  expect(output.write).toHaveBeenNthCalledWith(2, {
    chunk: Buffer.from("err"),
    channel: "stderr",
  });
  expect(child.stdout.pause).toHaveBeenCalledTimes(1);
  expect(child.stderr.pause).toHaveBeenCalledTimes(1);
  expect(child.stdout.resume).toHaveBeenCalledTimes(1);
  expect(child.stderr.resume).toHaveBeenCalledTimes(1);
});
