import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCliEnvironment,
  createCliTerminalCommand,
  quoteCliArgument,
} from "@/backend/agents/cli/CliEnvironment";

import type { CliHome } from "@/backend/agents/cli/CliContracts";

const HOME: CliHome = {
  root: "/srv/pages/agents/connection-1",
  home: "/srv/pages/agents/connection-1/home",
  config: "/srv/pages/agents/connection-1/config",
  work: "/srv/pages/agents/connection-1/work",
};
const EXECUTABLE = "/opt/tools/bin/synthetic-cli";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createCliEnvironment", () => {
  it("builds the isolated base environment from the connection home", () => {
    const environment = createCliEnvironment(HOME, "codex_cli", EXECUTABLE, {});
    expect(environment).toMatchObject({
      HOME: HOME.home,
      XDG_CONFIG_HOME: path.join(HOME.home, "config"),
      XDG_CACHE_HOME: path.join(HOME.home, "cache"),
      XDG_DATA_HOME: path.join(HOME.home, "data"),
      XDG_STATE_HOME: path.join(HOME.home, "state"),
      LANG: "C.UTF-8",
      TERM: "dumb",
      NO_COLOR: "1",
      CODEX_HOME: HOME.config,
    });
  });

  it("puts the Node and CLI directories before the system directories once each", () => {
    const environment = createCliEnvironment(
      HOME,
      "codex_cli",
      "/usr/bin/synthetic-cli",
      {},
    );
    const entries = environment.PATH.split(path.delimiter);
    expect(entries[0]).toBe(path.dirname(process.execPath));
    expect(entries).toContain("/usr/local/bin");
    expect(entries.filter((entry) => entry === "/usr/bin")).toHaveLength(1);
  });

  it("passes proxy and certificate settings but no other inherited variable", () => {
    const environment = createCliEnvironment(HOME, "claude_code", EXECUTABLE, {
      HTTPS_PROXY: "http://proxy.test:3128",
      NO_PROXY: "localhost",
      SSL_CERT_FILE: "/etc/ssl/ca.pem",
      ANTHROPIC_API_KEY: "synthetic-key",
      OPENAI_API_KEY: "synthetic-key",
      NODE_OPTIONS: "--require /tmp/hook.js",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
    });
    expect(environment.HTTPS_PROXY).toBe("http://proxy.test:3128");
    expect(environment.NO_PROXY).toBe("localhost");
    expect(environment.SSL_CERT_FILE).toBe("/etc/ssl/ca.pem");
    for (const name of [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "NODE_OPTIONS",
      "SSH_AUTH_SOCK",
    ])
      expect(environment).not.toHaveProperty(name);
    expect(environment).not.toHaveProperty("HTTP_PROXY");
  });

  it("reads the process environment when none is given", () => {
    vi.stubEnv("HTTP_PROXY", "http://process-proxy.test:8080");
    vi.stubEnv("GITHUB_TOKEN", "synthetic-token");
    const environment = createCliEnvironment(HOME, "codex_cli", EXECUTABLE);
    expect(environment.HTTP_PROXY).toBe("http://process-proxy.test:8080");
    expect(environment).not.toHaveProperty("GITHUB_TOKEN");
  });

  it("points Claude Code at its connection folder and silences updates", () => {
    const environment = createCliEnvironment(
      HOME,
      "claude_code",
      EXECUTABLE,
      {},
    );
    expect(environment).toMatchObject({
      CLAUDE_CONFIG_DIR: HOME.config,
      DISABLE_AUTOUPDATER: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    });
    expect(environment).not.toHaveProperty("CODEX_HOME");
  });

  it("keeps OpenCode's data below the config folder with every switch off", () => {
    const environment = createCliEnvironment(HOME, "opencode", EXECUTABLE, {});
    expect(environment.XDG_DATA_HOME).toBe(HOME.config);
    expect(environment).toMatchObject({
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_SHARE: "1",
      OPENCODE_PURE: "1",
    });
  });
});

describe("quoteCliArgument", () => {
  it.each([
    ["plain", "'plain'"],
    ["", "''"],
    ["two words", "'two words'"],
    ["it's", "'it'\\''s'"],
    ["$(touch /tmp/x)", "'$(touch /tmp/x)'"],
    ["a;b`c`", "'a;b`c`'"],
  ])("quotes %j as %s", (argument, quoted) => {
    expect(quoteCliArgument(argument)).toBe(quoted);
  });
});

describe("createCliTerminalCommand", () => {
  it("creates the folders, enters the work folder and runs the sign-in without inherited variables", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-key");
    const command = createCliTerminalCommand(HOME, "codex_cli", EXECUTABLE);
    expect(command.startsWith("umask 077; mkdir -p ")).toBe(true);
    expect(command).toContain(`cd '${HOME.work}' && env -i `);
    expect(command).toContain(`CODEX_HOME='${HOME.config}'`);
    expect(command).toContain(
      `'${EXECUTABLE}' 'login' '--device-auth' '-c' 'cli_auth_credentials_store="file"'`,
    );
    expect(command).not.toContain("synthetic-key");
  });

  it.each([
    ["claude_code", "'auth' 'login' '--claudeai'"],
    ["opencode", "'providers' 'login' '--provider' 'openrouter'"],
  ] as const)("uses the official sign-in command of %s", (provider, tail) => {
    const command = createCliTerminalCommand(HOME, provider, EXECUTABLE);
    expect(command.endsWith(`'${EXECUTABLE}' ${tail}`)).toBe(true);
  });

  it("quotes folder names with an apostrophe", () => {
    const quirky: CliHome = { ...HOME, work: "/srv/o'neil/work" };
    const command = createCliTerminalCommand(quirky, "codex_cli", EXECUTABLE);
    expect(command).toContain("cd '/srv/o'\\''neil/work' && ");
  });
});
