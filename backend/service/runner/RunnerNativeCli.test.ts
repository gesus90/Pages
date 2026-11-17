import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CliGitHubCredentials } from "@/backend/agents/cli/CliGitHubCredentials";
import { spawnCli } from "@/scripts/runner/cli.mjs";

const fixture = vi.hoisted(() => ({ directory: "", program: "" }));
vi.mock("@/backend/config/PagesTempDirectory", () => ({
  pagesTempDirectory: () => fixture.directory,
}));
vi.mock("@/scripts/runner/opencode.mjs", () => ({
  openCodeCommand: () => [fixture.program],
  openCodeInventory: async () => ({
    authentication: "authenticated",
    models: [{ id: "test-model", name: "Test", reasoningEfforts: [] }],
    catalogRevision: "fixture",
    acp: { status: "verified" },
  }),
}));
vi.mock("@/scripts/runner/antigravity.mjs", () => ({
  antigravityCommand: () => [fixture.program],
  antigravityInventory: async () => ({
    authentication: "authenticated",
    models: [{ id: "test-model", name: "Test", reasoningEfforts: [] }],
    catalogRevision: "fixture",
    acp: { status: "verified" },
  }),
}));

const NATIVE_PROBE = `
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
fs.writeFileSync('/dev/null', 'discarded');
if (fs.readFileSync('/dev/null').length !== 0) process.exit(2);
const descriptor = fs.openSync('/dev/urandom', 'r');
const bytes = Buffer.alloc(8);
if (fs.readSync(descriptor, bytes) !== 8) process.exit(3);
fs.closeSync(descriptor);
cp.execFileSync('/bin/bash', ['-c', ': >/dev/null']);
cp.execFileSync('git', ['--version']);
let denied = false;
try { fs.writeFileSync(path.join(process.env.GH_CONFIG_DIR, 'git-credential.sh'), 'changed'); }
catch (error) { denied = error.code === 'EACCES'; }
if (!denied) process.exit(4);
try { fs.writeFileSync(path.join(process.env.GH_CONFIG_DIR, 'new-file'), 'changed'); process.exit(5); }
catch (error) { if (error.code !== 'EACCES') throw error; }
fs.writeFileSync(path.join(process.env.EXTERNAL_FIXTURE, 'native.txt'), 'host-write');
process.stdout.write('native-tools-ok');
`;

async function prepareProvider(directory: string): Promise<void> {
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({ type: "commonjs" }),
  );
  fixture.program = path.join(directory, "native.cjs");
  await writeFile(fixture.program, NATIVE_PROBE);
  const provider = `#!${process.execPath}
if (process.argv.includes('--version')) console.info('1.0.0');
else if (process.argv.includes('status')) console.info(process.argv[2] === 'login' ? 'Logged in using ChatGPT' : JSON.stringify({loggedIn:true,authMethod:'claude.ai'}));
else if (process.argv.includes('models')) console.info(JSON.stringify({models:[{slug:'test-model',visibility:'list'}]}));
else if (process.argv.includes('--safe-mode')) console.info(JSON.stringify({type:'control_response',response:{request_id:'pages-model-catalog',subtype:'success',response:{models:[{value:'test-model'}]}}}));
else { ${NATIVE_PROBE} }
`;
  for (const name of ["codex", "claude"])
    await writeFile(path.join(directory, name), provider, { mode: 0o700 });
}

describe("native runner CLI", () => {
  let directory = "";
  beforeEach(async () => {
    const root = path.join(process.cwd(), ".native-cli-tests");
    await mkdir(root, { recursive: true });
    directory = await mkdtemp(path.join(root, "case-"));
    fixture.directory = directory;
    await prepareProvider(directory);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it.each(["claude", "codex", "opencode", "antigravity"])(
    "starts %s with usable devices and protected helpers without a mount wrapper",
    async (tool) => {
      const prepared = await new CliGitHubCredentials(directory).prepare({
        runner: true,
        instanceId: randomUUID(),
        access: { status: "unavailable", reason: "synthetic fixture" },
        gh: null,
        searchPath: process.env.PATH ?? "/usr/bin:/bin",
      });
      const original = await readFile(
        path.join(prepared.directory, "git-credential.sh"),
        "utf8",
      );
      const runtimeContext = {
        // An older server can still send this field. It must never wrap a native launch.
        readOnlyDirectory: prepared.directory,
        environment: {
          ...prepared.environment,
          PATH: `${directory}:${process.env.PATH}`,
          EXTERNAL_FIXTURE: directory,
        },
      };
      try {
        const child = await spawnCli(
          {
            workspace: directory,
            managed: { ownerId: "fixture" },
            runtimeContext,
            program: {
              model: "test-model",
              access: "yolo",
              reasoningEffort: null,
              route: { tool, catalogRevision: "fixture" },
            },
          },
          randomUUID(),
          new AbortController().signal,
          directory,
        );
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.stdin?.end();
        const code = await new Promise((resolve, reject) => {
          child.once("error", reject);
          child.once("close", resolve);
        });
        expect({ code, stderr, stdout }).toEqual({
          code: 0,
          stderr: "",
          stdout: "native-tools-ok",
        });
        expect(
          await readFile(
            path.join(prepared.directory, "git-credential.sh"),
            "utf8",
          ),
        ).toBe(original);
        expect(await readFile(path.join(directory, "native.txt"), "utf8")).toBe(
          "host-write",
        );
      } finally {
        await prepared.cleanup();
      }
    },
  );
});
