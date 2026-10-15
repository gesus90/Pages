import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";

import { credentialFiles } from "./memory-credential-files";

vi.mock("node:fs/promises", async () => {
  const { credentialFiles: files } = await import("./memory-credential-files");
  const functions = files.module();
  return { ...functions, default: functions };
});

const CONNECTION = "00000000-0000-4000-8000-000000000001";
const OTHER_CONNECTION = "00000000-0000-4000-8000-000000000002";
const ROOT = "/memory/pages/agents";
const store = new AgentCredentialStore("/memory/pages");

beforeEach(() => credentialFiles.reset());

describe("credential directory isolation", () => {
  it("restores owner-only modes throughout a connection folder", async () => {
    const home = await store.prepare(CONNECTION, "claude_code");
    const nested = path.join(home.home, "cache", "tool");
    const file = path.join(nested, "state.json");
    credentialFiles.seed(nested, "directory", 0o755);
    credentialFiles.seed(file, "file", 0o644);

    await store.secure(CONNECTION, "claude_code");

    expect(credentialFiles.entries.get(nested)?.mode).toBe(0o700);
    expect(credentialFiles.entries.get(file)?.mode).toBe(0o600);
    expect(credentialFiles.entries.get(home.root)?.mode).toBe(0o700);
  });

  it("never follows or changes links out of the connection folder", async () => {
    const home = await store.prepare(CONNECTION, "codex_cli");
    const registry = path.join(home.home, "data");
    const link = path.join(registry, "workspace");
    const secretLink = path.join(registry, "secret-link");
    credentialFiles.seed("/outside/workspace", "directory", 0o755);
    credentialFiles.seed("/outside/secret", "file", 0o644);
    credentialFiles.seed(link, "link");
    credentialFiles.seed(secretLink, "link");

    await expect(store.prepare(CONNECTION, "codex_cli")).resolves.toEqual(home);
    await expect(
      store.secure(CONNECTION, "codex_cli"),
    ).resolves.toBeUndefined();

    expect(credentialFiles.entries.get("/outside/workspace")?.mode).toBe(0o755);
    expect(credentialFiles.entries.get("/outside/secret")?.mode).toBe(0o644);
    expect(credentialFiles.changedModes).not.toContain(link);
    expect(credentialFiles.changedModes).not.toContain(secretLink);
  });

  it("refuses a connection root that is a symbolic link", async () => {
    credentialFiles.seed(ROOT, "link");

    await expect(store.prepare(CONNECTION, "codex_cli")).rejects.toMatchObject({
      code: "cli_not_executable",
    });
    expect(credentialFiles.changedModes).toEqual([]);
  });
});

describe("credential directory failures and cleanup", () => {
  it("rejects an invalid identifier before accessing files", () => {
    expect(() => store.paths("../outside", "codex_cli")).toThrow();
    expect(credentialFiles.changedModes).toEqual([]);
  });

  it("translates filesystem refusal into domain errors", async () => {
    credentialFiles.failure = new Error("synthetic filesystem refusal");

    await expect(store.prepare(CONNECTION, "codex_cli")).rejects.toMatchObject({
      code: "cli_not_executable",
    });
    await expect(store.secure(CONNECTION, "codex_cli")).rejects.toMatchObject({
      code: "cli_not_executable",
    });
    await expect(store.remove(CONNECTION, "codex_cli")).rejects.toMatchObject({
      code: "credential_cleanup_failed",
    });
  });

  it("removes only the selected connection and tolerates repeated cleanup", async () => {
    const selected = await store.prepare(CONNECTION, "codex_cli");
    const other = await store.prepare(OTHER_CONNECTION, "claude_code");

    await store.remove(CONNECTION, "codex_cli");
    await store.remove(CONNECTION, "codex_cli");

    expect(credentialFiles.removed).toEqual([selected.root]);
    expect(credentialFiles.entries.has(selected.root)).toBe(false);
    expect(credentialFiles.entries.has(other.root)).toBe(true);
  });

  it("does nothing when the credentials root does not exist", async () => {
    await expect(
      store.remove(CONNECTION, "codex_cli"),
    ).resolves.toBeUndefined();
    expect(credentialFiles.removed).toEqual([]);
  });

  it("refuses to remove a symlinked connection", async () => {
    credentialFiles.seed(ROOT, "directory");
    credentialFiles.seed(path.join(ROOT, CONNECTION), "link");

    await expect(store.remove(CONNECTION, "codex_cli")).rejects.toMatchObject({
      code: "credential_cleanup_failed",
    });
    expect(credentialFiles.removed).toEqual([]);
  });
});
