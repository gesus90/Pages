import { symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, it, vi } from "vitest";

import {
  installWorkerHooks,
  mocks,
  JOB_ID,
  state,
  scriptCommand,
  runWorker,
  storedResult,
} from "./runner-execution-worker-harness";

installWorkerHooks();

it.each([
  ["a changed execution revision", { revision: 9 }, { reason: "spawn" }],
  ["a negative timeout", { timeoutSeconds: -1 }, { reason: "spawn" }],
  ["a script without a timeout", { timeoutSeconds: 0 }, { reason: "spawn" }],
  ["an excessive timeout", { timeoutSeconds: 86401 }, { reason: "spawn" }],
  ["an excessive output budget", { outputBytes: 65537 }, { reason: "spawn" }],
  ["an oversized input", { input: "x".repeat(1048577) }, { reason: "spawn" }],
])(
  "refuses %s before starting anything",
  async (label, overrides, expected) => {
    await runWorker({ command: scriptCommand(overrides) });

    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(await storedResult()).toMatchObject({
      status: "failed",
      result: { output: null, exitCode: null, ...expected },
    });
  },
);

it("reports a workspace that moved as a changed plan context", async () => {
  await runWorker({
    command: scriptCommand({
      workspace: path.join(state.privateRoot, "missing"),
    }),
  });

  expect(mocks.spawn).not.toHaveBeenCalled();
  expect((await storedResult()).result.reason).toBe("spawn");
});

it("reports a workspace that is a link as a changed plan context", async () => {
  const link = path.join(state.privateRoot, "workspace-link");
  await symlink(state.workspace, link);

  await runWorker({ command: scriptCommand({ workspace: link }) });

  expect(await storedResult()).toMatchObject({
    status: "failed",
    result: { failureCode: "plan_context_changed", reason: "spawn" },
  });
});

it("reports a workspace that is no directory as a changed plan context", async () => {
  const file = path.join(state.privateRoot, "file");
  await writeFile(file, "x");

  await runWorker({ command: scriptCommand({ workspace: file }) });

  expect((await storedResult()).result.failureCode).toBe(
    "plan_context_changed",
  );
});

it.each([
  [
    "an unknown interpreter",
    { id: "ruby", path: "/usr/bin/ruby", digest: "d" },
  ],
  [
    "a moved interpreter",
    { id: "node", path: "/opt/node", digest: "digest-1" },
  ],
  ["a changed interpreter", { id: "node", path: "/usr/bin/node", digest: "x" }],
])("refuses %s", async (label, interpreter) => {
  await runWorker({
    command: scriptCommand({
      program: { kind: "script", source: "1", interpreter },
    }),
  });

  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(await storedResult()).toMatchObject({
    status: "failed",
    result: {
      failureCode: "plan_script_interpreter_unavailable",
      reason: "spawn",
    },
  });
});

function cliCommand(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return scriptCommand({
    timeoutSeconds: 0,
    program: {
      kind: "cli",
      access: "yolo",
      prompt: "do the thing",
      route: { tool: "codex" },
    },
    ...overrides,
  });
}

it("runs a CLI job without a timeout and writes the prompt", async () => {
  await runWorker({ command: cliCommand() });

  expect(mocks.spawnCli).toHaveBeenCalledWith(
    expect.objectContaining({ workspace: state.workspace }),
    JOB_ID,
    expect.any(AbortSignal),
    state.folder,
  );
  expect(state.children[0].stdin.end).toHaveBeenCalledWith("do the thing");
  expect((await storedResult()).status).toBe("completed");
});

it.each([
  ["a continuation of another version", { version: 2 }, "yolo"],
  ["a continuation of a read-only session", { version: 1 }, "read_only"],
  [
    "a continuation with a session id no command line could read",
    { version: 1, resumeSessionId: "--evil" },
    "yolo",
  ],
])("refuses %s", async (label, continuation, access) => {
  await runWorker({
    command: cliCommand({
      continuation,
      program: {
        kind: "cli",
        access,
        prompt: "p",
        route: { tool: "codex" },
      },
    }),
  });

  expect(mocks.spawnCli).not.toHaveBeenCalled();
  expect((await storedResult()).status).toBe("failed");
});

it("refuses a continuation of a script", async () => {
  await runWorker({ command: scriptCommand({ continuation: { version: 1 } }) });

  expect(mocks.spawn).not.toHaveBeenCalled();
  expect((await storedResult()).result.reason).toBe("spawn");
});

it("accepts a continuation with a plain session id", async () => {
  await runWorker({
    command: cliCommand({
      continuation: { version: 1, resumeSessionId: "abc_1.2:3-x" },
    }),
  });

  expect(mocks.spawnCli).toHaveBeenCalledTimes(1);
  expect((await storedResult()).status).toBe("completed");
});

it("accepts a continuation that names no session", async () => {
  await runWorker({ command: cliCommand({ continuation: { version: 1 } }) });

  expect(mocks.spawnCli).toHaveBeenCalledTimes(1);
});

it("maps a storage error of the CLI start to its own reason", async () => {
  await runWorker({
    command: cliCommand(),
    startError: Object.assign(new Error("full"), { code: "EROFS" }),
  });

  expect(await storedResult()).toMatchObject({
    status: "failed",
    result: { reason: "storage", storageError: "EROFS", output: null },
  });
});

it("takes the reason a failing start names for itself", async () => {
  await runWorker({
    command: cliCommand(),
    startError: Object.assign(new Error("x"), { reason: "protocol" }),
  });

  expect((await storedResult()).result.reason).toBe("protocol");
});

it("prepares Pages files and renews the lease while the job runs", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const prepared = scriptCommand({ pagesAccess: 1, input: "prepared-input" });
  mocks.preparePagesFiles.mockResolvedValue(prepared);
  mocks.pagesRequest.mockResolvedValue({});

  await runWorker({
    command: scriptCommand({ pagesAccess: 1 }),
    onInput: () => {
      // The second tick finds the first request still busy.
      vi.advanceTimersByTime(5000);
      vi.advanceTimersByTime(5000);
    },
  });

  expect(mocks.preparePagesFiles).toHaveBeenCalledWith(
    expect.objectContaining({ pagesAccess: 1 }),
    state.folder,
    JOB_ID,
    expect.any(AbortSignal),
  );
  expect(mocks.pagesRequest).toHaveBeenCalledWith(
    path.join(state.privateRoot, "pages.sock"),
    JOB_ID,
    { kind: "lease" },
  );
  expect(state.children[0].stdin.end).toHaveBeenCalledWith("prepared-input");
  expect((await storedResult()).status).toBe("completed");
});

it("keeps running when only the Pages transport is unavailable", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  mocks.preparePagesFiles.mockImplementation(async (command) => command);
  mocks.pagesRequest.mockRejectedValue(
    Object.assign(new Error("down"), { code: "pages_transport_unavailable" }),
  );

  await runWorker({
    command: scriptCommand({ pagesAccess: 1 }),
    onInput: () => vi.advanceTimersByTime(5000),
  });

  expect((await storedResult()).status).toBe("completed");
});

it("keeps running when the lease request fails without a code", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  mocks.preparePagesFiles.mockImplementation(async (command) => command);
  mocks.pagesRequest.mockRejectedValue(new Error("reset"));

  await runWorker({
    command: scriptCommand({ pagesAccess: 1 }),
    onInput: () => vi.advanceTimersByTime(5000),
  });

  expect((await storedResult()).status).toBe("completed");
});

it("stops the job when Pages refuses the lease", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  mocks.preparePagesFiles.mockImplementation(async (command) => command);
  mocks.pagesRequest.mockRejectedValue(
    Object.assign(new Error("revoked"), { code: "plan_access_denied" }),
  );

  await runWorker({
    command: scriptCommand({ pagesAccess: 1 }),
    exit: null,
    closeOnStop: true,
    onInput: () => vi.advanceTimersByTime(5000),
  });

  expect(await storedResult()).toMatchObject({
    status: "interrupted",
    result: { reason: "cancelled" },
  });
});

it("reports a failed preparation of Pages files with its stable code", async () => {
  mocks.preparePagesFiles.mockRejectedValue(
    Object.assign(new Error("asset"), {
      code: "parameter_asset_conflict",
      assetFailure: { name: "a.txt" },
    }),
  );
  mocks.pagesFailure.mockReturnValue("parameter_asset_conflict");

  await runWorker({ command: scriptCommand({ pagesAccess: 1 }) });

  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(await storedResult()).toMatchObject({
    status: "failed",
    result: {
      resourceError: "parameter_asset_conflict",
      assetFailure: { name: "a.txt" },
      reason: "spawn",
      output: null,
    },
  });
});
