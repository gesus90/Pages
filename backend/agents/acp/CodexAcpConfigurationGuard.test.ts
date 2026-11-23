import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "smol-toml";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  findUnmanagedCodexConfiguration,
  findUnmanagedCodexHomeConfiguration,
} from "@/backend/agents/acp/CodexAcpConfigurationGuard";
import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import type * as SmolToml from "smol-toml";

vi.mock("smol-toml", async (importOriginal) => {
  const original = await importOriginal<typeof SmolToml>();
  return { ...original, parse: vi.fn(original.parse) };
});
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

let root = "";

beforeEach(async () => {
  await mkdir(pagesTempDirectory("codex-guard-test"), { recursive: true });
  root = await mkdtemp(pagesTempDirectory("codex-guard-test", "case-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(file: string, text: string): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return file;
}

it("finds no home configuration when the file is missing", async () => {
  expect(await findUnmanagedCodexHomeConfiguration(root)).toBeNull();
});

it("accepts a file that holds only folder trust", async () => {
  await write(
    path.join(root, "config.toml"),
    '[projects."/a"]\ntrust_level = "trusted"\n',
  );
  expect(await findUnmanagedCodexHomeConfiguration(root)).toBeNull();
});

it("accepts an empty file", async () => {
  await write(path.join(root, "config.toml"), "");
  expect(await findUnmanagedCodexHomeConfiguration(root)).toBeNull();
});

it.each([
  ["a setting", 'model = "x"\n'],
  ["another table", "[mcp_servers.a]\ncommand = 'x'\n"],
  ["projects that is no table", "projects = 1\n"],
  [
    "a project with another key",
    '[projects."/a"]\ntrust_level = "trusted"\nx = 1\n',
  ],
  ["an unknown trust level", '[projects."/a"]\ntrust_level = "other"\n'],
  ["a project that is no table", "[projects]\na = 1\n"],
  ["a project with another only key", '[projects."/a"]\nother = "trusted"\n'],
  ["invalid text", "= = ="],
])("reports a file with %s", async (label, text) => {
  const file = await write(path.join(root, "config.toml"), text);
  expect(await findUnmanagedCodexHomeConfiguration(root)).toBe(file);
});

it("reports a file larger than a trust record", async () => {
  const file = await write(
    path.join(root, "config.toml"),
    `# ${"x".repeat(300 * 1024)}\n`,
  );
  expect(await findUnmanagedCodexHomeConfiguration(root)).toBe(file);
});

it("reports a home configuration before the project", async () => {
  const file = await write(path.join(root, "home", "config.toml"), "a = 1\n");
  expect(
    await findUnmanagedCodexConfiguration(path.join(root, "home"), root),
  ).toBe(file);
});

it("finds a project configuration between the working directory and the git root", async () => {
  await mkdir(path.join(root, "repo", ".git"), { recursive: true });
  const file = await write(
    path.join(root, "repo", ".codex", "config.toml"),
    "a = 1\n",
  );
  const work = path.join(root, "repo", "sub");
  await mkdir(work, { recursive: true });
  expect(
    await findUnmanagedCodexConfiguration(path.join(root, "none"), work),
  ).toBe(file);
});

it("finds nothing in a repository without configuration", async () => {
  await mkdir(path.join(root, "repo", ".git"), { recursive: true });
  expect(
    await findUnmanagedCodexConfiguration(
      path.join(root, "none"),
      path.join(root, "repo"),
    ),
  ).toBeNull();
});

it("reads only the working directory without a git root", async () => {
  const lonely = path.join(root, "plain");
  await mkdir(lonely, { recursive: true });
  expect(
    await findUnmanagedCodexConfiguration(path.join(root, "none"), lonely),
  ).toBeNull();
});

it("reports a file whose parsed document is no table", async () => {
  const file = await write(path.join(root, "config.toml"), "a = 1\n");
  vi.mocked(parse).mockReturnValueOnce([] as never);
  expect(await findUnmanagedCodexHomeConfiguration(root)).toBe(file);
});
