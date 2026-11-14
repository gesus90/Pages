import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { CliGitHubCredentials } from "@/backend/agents/cli/CliGitHubCredentials";

import type { CliGitHubAccess } from "@/backend/agents/cli/CliGitHubCredentials";

const INSTANCE = "00603eeb-382e-4822-afc4-43c3cedb0ea1";
const TOKEN = "ghp_page371SyntheticToken";
let dataDirectory: string;
let toolDirectory: string;

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "pages-371-data-"));
  toolDirectory = await mkdtemp(path.join(os.tmpdir(), "pages-371-tool-"));
});

afterEach(async () => {
  await rm(dataDirectory, { recursive: true, force: true });
  await rm(toolDirectory, { recursive: true, force: true });
});

/** A stand-in for `gh auth git-credential get` that answers with the stored token. */
async function fakeGh(): Promise<string> {
  const gh = path.join(toolDirectory, "gh");
  await writeFile(
    gh,
    `#!/bin/sh\ncat >/dev/null\nprintf 'username=x-access-token\\npassword=${TOKEN}\\n'\n`,
  );
  await chmod(gh, 0o700);
  return gh;
}

function runHelper(
  access: CliGitHubAccess,
  action: "get" | "erase",
  request: string,
): Promise<{ stdout: string; stderr: string }> {
  const helper = path.join(access.directory, "git-credential.sh");
  return new Promise((resolve, reject) => {
    const child = execFile(
      "/bin/sh",
      [helper, action],
      (error, stdout, stderr) =>
        error ? reject(error) : resolve({ stdout, stderr }),
    );
    child.stdin?.end(request);
  });
}

async function prepared(withToken: boolean): Promise<CliGitHubAccess> {
  const credentials = new CliGitHubCredentials(dataDirectory);
  return credentials.prepare(
    withToken
      ? {
          instanceId: INSTANCE,
          access: {
            status: "available",
            repository: "gesus90/Pages",
            token: TOKEN,
            writeAccess: "verified",
          },
          gh: await fakeGh(),
          searchPath: "/usr/bin",
        }
      : {
          instanceId: INSTANCE,
          access: { status: "unavailable", reason: "not configured" },
          gh: null,
          searchPath: "/usr/bin",
        },
  );
}

const request = (repository: string): string =>
  `protocol=https\nhost=github.com\npath=${repository}\n\n`;

it("serves the stored token for a private repository outside the project", async () => {
  const access = await prepared(true);
  for (const repository of ["gesus90/Pages-MCP.git", "Other/Private", ""]) {
    const { stdout } = await runHelper(access, "get", request(repository));
    expect(stdout).toContain(`password=${TOKEN}`);
  }
  const project = await runHelper(access, "get", request("gesus90/Pages.git"));
  expect(project.stdout).toContain(`password=${TOKEN}`);
});

it("registers the helper for https://github.com without a prompt", async () => {
  const access = await prepared(true);
  const { environment } = access;
  expect(environment.GIT_TERMINAL_PROMPT).toBe("0");
  expect(environment.GIT_CONFIG_GLOBAL).toBe("/dev/null");
  const values = Object.entries(environment)
    .filter(([key]) => key.startsWith("GIT_CONFIG_VALUE_"))
    .map(([, value]) => value);
  expect(values).toContain(
    `!/bin/sh '${path.join(access.directory, "git-credential.sh")}'`,
  );
  expect(values).toContain("true");
});

it("hands out nothing for other hosts or protocols", async () => {
  const access = await prepared(true);
  for (const input of [
    "protocol=https\nhost=example.com\npath=a/b\n\n",
    "protocol=http\nhost=github.com\npath=a/b\n\n",
  ]) {
    const { stdout } = await runHelper(access, "get", input);
    expect(stdout).toBe("");
  }
});

it("explains a rejected token on erase without printing it", async () => {
  const access = await prepared(true);
  const other = await runHelper(access, "erase", request("a/b"));
  expect(other.stderr).toContain("rejected the stored project token");
  expect(other.stderr).not.toContain(TOKEN);
  expect(other.stdout).toBe("");
});

it("never writes the token into the environment, and the directory vanishes at cleanup", async () => {
  const access = await prepared(true);
  expect(JSON.stringify(access.environment)).not.toContain(TOKEN);
  expect(access.redact(`fatal: ${TOKEN}`)).toBe("fatal: [redacted]");
  await access.cleanup();
  expect(await readdir(dataDirectory)).toEqual([]);
  await expect(
    runHelper(access, "get", request("a/b")),
  ).rejects.toBeDefined();
});

it("without a stored token prints a visible message and no credential", async () => {
  const access = await prepared(false);
  const { stdout, stderr } = await runHelper(
    access,
    "get",
    request("gesus90/Pages-MCP"),
  );
  expect(stdout).toBe("");
  expect(stderr).toContain("no GitHub credential");
  expect(access.environment.GIT_TERMINAL_PROMPT).toBe("0");
  expect(await readFile(path.join(access.directory, "config.yml"), "utf8")).not.toContain(TOKEN);
});
