import * as filesystem from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import { CliLocator } from "@/backend/agents/cli/CliLocator";
import {
  createCliEnvironment,
  createCliTerminalCommand,
  quoteCliArgument,
} from "@/backend/agents/cli/CliEnvironment";

import { CLI_HOME } from "../helpers/agent-cli";

const ID = "00000000-0000-4000-8000-000000000001";
let directory = "";
beforeEach(async () => {
  directory = await filesystem.mkdtemp(path.join(tmpdir(), "pages-agent-cli-"));
});
afterEach(async () => {
  await filesystem.rm(directory, { force: true, recursive: true });
});

describe("isolated agent credential store", () => {
  it("creates and repairs private modes without reading credentials", async () => {
    const store = new AgentCredentialStore(directory);
    const home = await store.prepare(ID, "codex_cli");
    for (const item of [
      path.join(directory, "agents"),
      home.root,
      home.home,
      home.config,
      home.work,
      path.join(home.home, "config"),
    ])
      expect((await filesystem.stat(item)).mode & 0o777).toBe(0o700);
    const token = path.join(home.config, "auth.json");
    await filesystem.writeFile(token, "synthetic-credential", { mode: 0o644 });
    await filesystem.mkdir(path.join(home.config, "nested"), { mode: 0o755 });
    await filesystem.symlink(
      "auth.json",
      path.join(home.config, "internal-link"),
    );
    await store.secure(ID, "codex_cli");
    expect((await filesystem.stat(token)).mode & 0o777).toBe(0o600);
    expect(
      (await filesystem.stat(path.join(home.config, "nested"))).mode & 0o777,
    ).toBe(0o700);
    await store.prepare(ID, "codex_cli");
    await store.remove(ID, "codex_cli");
    await expect(filesystem.stat(home.root)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await store.remove(ID, "codex_cli");
    await filesystem.rm(path.join(directory, "agents"), { recursive: true });
    await store.remove(ID, "codex_cli");
    expect(store.paths(ID, "claude_code").config.endsWith("/claude")).toBe(
      true,
    );
  });

  it("rejects non-UUID paths before filesystem work", async () => {
    const mkdir = vi.fn(async () => undefined);
    const store = new AgentCredentialStore(directory, { ...filesystem, mkdir });
    for (const invalid of ["..", "../private", "", "not-an-id", ID + "/.."]) {
      expect(() => store.paths(invalid, "codex_cli")).toThrow();
      await expect(store.prepare(invalid, "codex_cli")).rejects.toMatchObject({
        code: "connection_not_found",
      });
      await expect(store.remove(invalid, "codex_cli")).rejects.toMatchObject({
        code: "connection_not_found",
      });
    }
    expect(mkdir).not.toHaveBeenCalled();
  });

  it("refuses root symlinks and escaping child links without touching their target", async () => {
    const store = new AgentCredentialStore(directory);
    const privateDirectory = path.join(directory, "private-fixture");
    await filesystem.mkdir(privateDirectory, { mode: 0o755 });
    await filesystem.symlink(privateDirectory, path.join(directory, "agents"));
    await expect(store.prepare(ID, "codex_cli")).rejects.toMatchObject({
      code: "cli_not_executable",
    });
    await expect(store.remove(ID, "codex_cli")).rejects.toMatchObject({
      code: "credential_cleanup_failed",
    });
    expect((await filesystem.stat(privateDirectory)).mode & 0o777).toBe(0o755);
    await filesystem.unlink(path.join(directory, "agents"));
    const home = await store.prepare(ID, "claude_code");
    await filesystem.symlink(
      privateDirectory,
      path.join(home.config, "escape"),
    );
    await expect(store.secure(ID, "claude_code")).rejects.toMatchObject({
      code: "cli_not_executable",
    });
    await store.remove(ID, "claude_code");
    expect((await filesystem.stat(privateDirectory)).isDirectory()).toBe(true);
  });

  it("accepts only Codex helper links to its own binary in the arg0 runtime folder", async () => {
    const store = new AgentCredentialStore(directory);
    const home = await store.prepare(ID, "codex_cli");
    const binary = path.join(directory, "install", "bin", "codex");
    await filesystem.mkdir(path.dirname(binary), { recursive: true });
    await filesystem.writeFile(binary, "synthetic-binary");
    await filesystem.chmod(binary, 0o755);
    const helpers = path.join(home.config, "tmp", "arg0", "codex-arg0fixture");
    await filesystem.mkdir(helpers, { recursive: true });
    for (const name of ["apply_patch", "codex-linux-sandbox"])
      await filesystem.symlink(binary, path.join(helpers, name));
    await store.secure(ID, "codex_cli");
    await store.prepare(ID, "codex_cli");
    expect((await filesystem.stat(binary)).mode & 0o777).toBe(0o755);
    const credential = path.join(directory, "private-auth.json");
    await filesystem.writeFile(credential, "synthetic-credential");
    await filesystem.chmod(credential, 0o644);
    await filesystem.symlink(credential, path.join(helpers, "auth.json"));
    await expect(store.secure(ID, "codex_cli")).rejects.toMatchObject({
      code: "cli_not_executable",
    });
    await filesystem.unlink(path.join(helpers, "auth.json"));
    await filesystem.symlink(binary, path.join(home.config, "codex"));
    await expect(store.prepare(ID, "codex_cli")).rejects.toMatchObject({
      code: "cli_not_executable",
    });
    expect((await filesystem.stat(credential)).mode & 0o777).toBe(0o644);
    await store.remove(ID, "codex_cli");
    expect((await filesystem.stat(binary)).isFile()).toBe(true);
  });

  it("converts storage failures into stable codes", async () => {
    const store = new AgentCredentialStore(directory);
    await store.prepare(ID, "codex_cli");
    const rm = vi
      .fn<typeof filesystem.rm>()
      .mockRejectedValue(new Error("sensitive-path"));
    await expect(
      new AgentCredentialStore(directory, { ...filesystem, rm }).remove(
        ID,
        "codex_cli",
      ),
    ).rejects.toMatchObject({ code: "credential_cleanup_failed" });
    for (const error of [
      new Error("denied"),
      null,
      "disk",
      { code: "EACCES" },
    ]) {
      const lstat = vi.fn(async () => {
        throw error;
      });
      await expect(
        new AgentCredentialStore(directory, { ...filesystem, lstat }).prepare(
          ID,
          "codex_cli",
        ),
      ).rejects.toMatchObject({ code: "cli_not_executable" });
    }
  });
});

describe("CLI discovery and environment", () => {
  it("prefers PATH then the current Node directory, ignoring non-executable files and directories", async () => {
    const first = path.join(directory, "first");
    const fallback = path.join(directory, "node");
    await filesystem.mkdir(first);
    await filesystem.mkdir(fallback);
    await filesystem.writeFile(path.join(first, "codex"), "fake", {
      mode: 0o700,
    });
    await filesystem.writeFile(path.join(fallback, "codex"), "fake", {
      mode: 0o700,
    });
    const locator = new CliLocator(
      `${first}:relative:`,
      path.join(fallback, "node"),
    );
    expect((await locator.find("codex_cli")).path).toBe(
      path.join(first, "codex"),
    );
    await filesystem.chmod(path.join(first, "codex"), 0o600);
    expect((await locator.find("codex_cli")).path).toBe(
      path.join(fallback, "codex"),
    );
    await filesystem.mkdir(path.join(first, "claude"), { mode: 0o700 });
    expect(await locator.find("claude_code")).toEqual({
      found: false,
      path: null,
    });
    expect(await locator.list()).toMatchObject({
      codex_cli: { found: true },
      claude_code: { found: false },
    });
    vi.stubEnv("PATH", undefined);
    expect(
      await new CliLocator(undefined, path.join(first, "node")).find(
        "codex_cli",
      ),
    ).toEqual({ found: false, path: null });
    vi.stubEnv("PATH", first);
    expect(await new CliLocator().find("claude_code")).toEqual(
      expect.objectContaining({ found: expect.any(Boolean) }),
    );
  });

  it("passes only the allowlist, fixed homes, and proxy/CA configuration", () => {
    const inherited = Object.fromEntries(
      [
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "CODEX_API_KEY",
        "CODEX_ACCESS_TOKEN",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "CLAUDE_CODE_USE_BEDROCK",
        "PAGES_GITHUB_TOKEN_KEY",
        "NODE_OPTIONS",
        "DISPLAY",
        "WAYLAND_DISPLAY",
        "DBUS_SESSION_BUS_ADDRESS",
        "HOME",
        "XDG_CONFIG_HOME",
      ].map((key) => [key, "private-marker"]),
    );
    Object.assign(inherited, {
      HTTPS_PROXY: "https://proxy",
      HTTP_PROXY: "http://proxy",
      NO_PROXY: "localhost",
      SSL_CERT_FILE: "/ca.pem",
      NODE_EXTRA_CA_CERTS: "/extra.pem",
    });
    const codex = createCliEnvironment(
      CLI_HOME,
      "codex_cli",
      "/opt/bin/codex",
      inherited,
    );
    expect(JSON.stringify(codex)).not.toContain("private-marker");
    expect(codex).toMatchObject({
      HOME: CLI_HOME.home,
      CODEX_HOME: CLI_HOME.config,
      LANG: "C.UTF-8",
      TERM: "dumb",
      NO_COLOR: "1",
      HTTPS_PROXY: "https://proxy",
      NODE_EXTRA_CA_CERTS: "/extra.pem",
    });
    expect(codex.PATH).toContain(path.dirname(process.execPath));
    const claude = createCliEnvironment(
      CLI_HOME,
      "claude_code",
      "/opt/bin/claude",
      {},
    );
    expect(claude).toMatchObject({
      CLAUDE_CONFIG_DIR: CLI_HOME.config,
      DISABLE_AUTOUPDATER: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    });
    expect(claude.CODEX_HOME).toBeUndefined();
    vi.stubEnv("OPENAI_API_KEY", "private-marker");
    expect(
      JSON.stringify(createCliEnvironment(CLI_HOME, "codex_cli", "codex")),
    ).not.toContain("private-marker");
  });

  it("quotes terminal paths and clears ambient credentials in both fallback commands", () => {
    expect(quoteCliArgument("a'b")).toBe("'a'\\''b'");
    for (const provider of ["codex_cli", "claude_code"] as const) {
      const command = createCliTerminalCommand(
        CLI_HOME,
        provider,
        "/opt/cli'file",
      );
      expect(command).toContain("umask 077;");
      expect(command).toContain("env -i");
      expect(command).toContain(quoteCliArgument(CLI_HOME.home));
      expect(command).toContain(
        provider === "codex_cli" ? "forced_login_method" : "--claudeai",
      );
    }
  });
});
