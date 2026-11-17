import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";
import { interpreterCatalog } from "@/scripts/runner/interpreters.mjs";
import {
  prepareScript,
  scriptEnvironment,
  scriptLimits,
  scriptSearchPath,
  spawnScript,
} from "@/scripts/runner/scripts.mjs";

import type {
  ScriptCommand,
  ScriptInterpreter,
} from "@/scripts/runner/scripts.mjs";

const SYSTEM_PATH = "/usr/local/bin:/usr/bin:/bin";
const NODE_DIRECTORY = path.dirname(process.execPath);
const IS_LINUX = process.platform === "linux";

interface ScriptOutcome {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Counts the account's threads the way the runner does, so the process limit leaves room to fork. */
async function accountThreadCount(): Promise<number> {
  let count = 0;
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/u.test(entry)) continue;
    const status = await readFile(`/proc/${entry}/status`, "utf8").catch(
      () => "",
    );
    if (Number(/^Uid:\s+(\d+)/mu.exec(status)?.[1]) === process.getuid?.())
      count += Number(/^Threads:\s+(\d+)/mu.exec(status)?.[1] ?? 1);
  }
  return count;
}

async function createCaseFolder(): Promise<string> {
  const root = pagesTempDirectory("runner-script-tests");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const folder = await mkdtemp(path.join(root, "case-"));
  await mkdir(path.join(folder, "runtime"), { mode: 0o700 });
  await mkdir(path.join(folder, "workspace"));
  await writeFile(
    path.join(folder, "workspace", "fixture.json"),
    JSON.stringify({ items: [1, 2, 3], name: "fixture" }),
  );
  return folder;
}

async function profile(id: string): Promise<ScriptInterpreter> {
  const found = (await interpreterCatalog()).interpreters.find(
    (entry) => entry.id === id,
  );
  if (!found) throw new Error(`Interpreter ${id} is not installed`);
  return found;
}

function commandFor(
  folder: string,
  interpreter: ScriptInterpreter,
  source: string,
): ScriptCommand {
  return {
    workspace: path.join(folder, "workspace"),
    timeoutSeconds: 60,
    program: { interpreter, source },
  };
}

/** Prepares and starts a script exactly like the worker does, then collects its output. */
async function runScript(
  folder: string,
  id: string,
  source: string,
): Promise<ScriptOutcome> {
  const command = commandFor(folder, await profile(id), source);
  await prepareScript(command, path.join(folder, "runtime"));
  const child = spawnScript(command, folder, randomUUID());
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  child.stdin.end("{}");
  const exitCode = await new Promise<number | null>((resolve) =>
    child.once("close", resolve),
  );
  return { exitCode, stdout, stderr };
}

describe("script environment", () => {
  it("adds the directory of the advertised Node binary ahead of the system directories", () => {
    expect(scriptSearchPath("/home/user/.nvm/versions/node/v24/bin/node")).toBe(
      `/home/user/.nvm/versions/node/v24/bin:${SYSTEM_PATH}`,
    );
  });

  it("does not repeat a system directory", () => {
    expect(scriptSearchPath("/usr/bin/node")).toBe(SYSTEM_PATH);
  });

  it.each(["node", "./bin/node", "/opt/tools:evil/node"])(
    "refuses to extend the path with an unusable Node location %s",
    (nodeExecutable) => {
      expect(scriptSearchPath(nodeExecutable)).toBe(SYSTEM_PATH);
    },
  );

  it("passes nothing from the runner service environment to a script", () => {
    vi.stubEnv("PAGES_RUNNER_TOKEN", "service-secret");
    vi.stubEnv("PATH", "/home/user/private-tools:/usr/bin");
    const environment = scriptEnvironment("/run/job/runtime", "job-1");
    expect(Object.keys(environment).sort()).toEqual(
      [
        "HOME",
        "LANG",
        "LC_ALL",
        "NODE_COMPILE_CACHE",
        "NODE_OPTIONS",
        "PAGES_REMOTE_JOB",
        "PATH",
        "TEMP",
        "TMP",
        "TMPDIR",
      ].sort(),
    );
    expect(environment.HOME).toBe("/run/job/runtime");
    expect(JSON.stringify(environment)).not.toContain("service-secret");
    expect(environment.PATH).not.toContain("private-tools");
  });

  it("starts every nested Node process without JIT and with the small heap", () => {
    expect(scriptEnvironment("/run/job/runtime", "job-1").NODE_OPTIONS).toBe(
      "--jitless --max-old-space-size=128",
    );
  });
});

describe("script limits", () => {
  it("gives every interpreter an address space a nested Node can start in", () => {
    const limits = scriptLimits(30, 100);
    expect(limits).toContain("--as=1073741824");
    expect(limits).toContain("--cpu=31");
    expect(limits).toContain("--nproc=356");
    expect(limits).toContain("--nofile=128");
    expect(limits).toContain("--fsize=10485760");
    expect(limits).toContain("--core=0");
  });
});

describe.skipIf(!IS_LINUX)("nested Node in a script", () => {
  let folder = "";

  beforeEach(async () => {
    folder = await createCaseFolder();
    vi.stubEnv("PAGES_RUNNER_HOST_TASKS", String(await accountThreadCount()));
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it("lets a Bash script run a bare node that parses JSON from the workspace", async () => {
    const source = [
      "set -eu",
      `node -e 'const j = require("./fixture.json"); process.stdout.write(String(j.items.reduce((a, b) => a + b, 0)) + ":" + j.name)'`,
    ].join("\n");
    expect(await runScript(folder, "bash", source)).toEqual({
      exitCode: 0,
      stdout: "6:fixture",
      stderr: "",
    });
  });

  it("resolves the bare node to the binary of the runner and runs it under the Node policy", async () => {
    const source = [
      "set -eu",
      "command -v node",
      `node -p 'typeof WebAssembly + " " + (require("v8").getHeapStatistics().heap_size_limit < 400 * 1024 * 1024)'`,
    ].join("\n");
    const outcome = await runScript(folder, "bash", source);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout.split("\n").slice(0, 2)).toEqual([
      path.join(NODE_DIRECTORY, "node"),
      "undefined true",
    ]);
  });

  it("lets a Python script start node and keeps git and python reachable", async () => {
    const source = [
      "import subprocess",
      `print(subprocess.run(["node", "-p", "JSON.stringify(process.version)"], check=True, capture_output=True, text=True).stdout.strip())`,
      `print(subprocess.run(["git", "--version"], check=True, capture_output=True, text=True).stdout.strip())`,
    ].join("\n");
    const outcome = await runScript(folder, "python3", source);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`"${process.version}"`);
    expect(outcome.stdout).toContain("git version");
  });

  it("still runs a Node script under the guard", async () => {
    const source =
      "process.stdout.write(typeof WebAssembly + ':' + process.argv.length);";
    expect(await runScript(folder, "node", source)).toEqual({
      exitCode: 0,
      stdout: "undefined:2",
      stderr: "",
    });
  });
});

describe.skipIf(!IS_LINUX)("script boundaries", () => {
  let folder = "";

  beforeEach(async () => {
    folder = await createCaseFolder();
    vi.stubEnv("PAGES_RUNNER_HOST_TASKS", String(await accountThreadCount()));
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it("does not leak the runner service environment into the script", async () => {
    vi.stubEnv("PAGES_RUNNER_TOKEN", "service-secret");
    const source = 'printf "%s" "${PAGES_RUNNER_TOKEN:-absent}"';
    expect(await runScript(folder, "bash", source)).toEqual({
      exitCode: 0,
      stdout: "absent",
      stderr: "",
    });
  });

  it("reports a missing tool as exit 127 instead of hiding it", async () => {
    const outcome = await runScript(
      folder,
      "bash",
      "pages-tool-that-does-not-exist",
    );
    expect(outcome.exitCode).toBe(127);
    expect(outcome.stderr).toContain("not found");
  });

  it("refuses a script whose interpreter changed since the plan pinned it", async () => {
    const changed = { ...(await profile("bash")), digest: "0".repeat(64) };
    const command = commandFor(folder, changed, "true");
    await expect(
      prepareScript(command, path.join(folder, "runtime")),
    ).rejects.toMatchObject({
      failureCode: "plan_script_interpreter_unavailable",
    });
  });

  it("refuses to start without a trustworthy host task count", async () => {
    const command = commandFor(folder, await profile("bash"), "true");
    vi.stubEnv("PAGES_RUNNER_HOST_TASKS", "many");
    expect(() => spawnScript(command, folder, randomUUID())).toThrow(
      "Host task count unavailable",
    );
  });
});
