import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";

const CONNECTION = "00000000-0000-4000-8000-000000000001";
let base = "";
let store: AgentCredentialStore;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "pages-credential-store-"));
  await mkdir(path.join(base, "data"));
  store = new AgentCredentialStore(path.join(base, "data"));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

async function mode(file: string): Promise<number> {
  return (await stat(file)).mode & 0o777;
}

it("restores owner-only modes in the whole folder of the connection", async () => {
  const home = await store.prepare(CONNECTION, "claude_code");
  const nested = path.join(home.home, "cache", "tool");
  await mkdir(nested, { recursive: true });
  await chmod(nested, 0o755);
  const file = path.join(nested, "state.json");
  await writeFile(file, "{}");
  await chmod(file, 0o644);
  await store.secure(CONNECTION, "claude_code");
  expect(await mode(nested)).toBe(0o700);
  expect(await mode(file)).toBe(0o600);
});

it("leaves a link that points out of the folder alone, instead of blocking the connection", async () => {
  // The project registry of pnpm names every workspace it ran in, below XDG_DATA_HOME of the session.
  const workspace = path.join(base, "workspace");
  await mkdir(workspace);
  await chmod(workspace, 0o755);
  const home = await store.prepare(CONNECTION, "codex_cli");
  const registry = path.join(home.home, "data", "pnpm", "projects");
  await mkdir(registry, { recursive: true });
  await symlink(workspace, path.join(registry, "workspace"));
  await writeFile(path.join(base, "secret"), "x");
  await chmod(path.join(base, "secret"), 0o644);
  await symlink(path.join(base, "secret"), path.join(registry, "secret-link"));

  await expect(store.prepare(CONNECTION, "codex_cli")).resolves.toEqual(home);
  await expect(store.secure(CONNECTION, "codex_cli")).resolves.toBeUndefined();
  // No mode is set through a link: what it points to keeps its own.
  expect(await mode(workspace)).toBe(0o755);
  expect(await mode(path.join(base, "secret"))).toBe(0o644);
});

it("still refuses a folder of the connection that is a link", async () => {
  const outside = path.join(base, "outside");
  await mkdir(outside);
  await symlink(outside, path.join(base, "data", "agents"));
  await expect(store.prepare(CONNECTION, "codex_cli")).rejects.toMatchObject({
    code: "cli_not_executable",
  });
});
