import path from "node:path";

import { expect, it, vi } from "vitest";

import {
  createCliEnvironment,
  createCliRequestEnvironment,
  createCliTerminalCommand,
  nativeProviderEnvironment,
  quoteCliArgument,
} from "@/backend/agents/cli/CliEnvironment";
import { sharedPnpmBin } from "@/backend/agents/cli/AgentSharedEnvironment";

import type { CliProviderId } from "@/definition/AgentConnection";
import type { CliHome } from "@/backend/agents/cli/CliContracts";

vi.mock("@/backend/logging/LogCorrelation", () => ({
  correlationEnvironment: () => ({ PAGES_CORRELATION: "synthetic" }),
}));

const HOME: CliHome = {
  root: "/synthetic/root",
  home: "/synthetic/root/home",
  config: "/synthetic/root/config",
  work: "/synthetic/root/work",
};
const SHARED: CliHome = { ...HOME, sharedEnvironment: "/synthetic/shared" };
const PROVIDERS: readonly CliProviderId[] = [
  "codex_cli",
  "claude_code",
  "antigravity",
  "opencode",
];

it("builds the allowlist with default folders and passes only proxy variables", () => {
  const environment = createCliEnvironment(
    HOME,
    "codex_cli",
    "/opt/tool/bin/cli",
    {
      HTTPS_PROXY: "http://proxy.invalid",
      NO_PROXY: "localhost",
      SECRET_KEY: "private",
    },
  );

  expect(environment).toMatchObject({
    HOME: HOME.home,
    XDG_CONFIG_HOME: "/synthetic/root/home/config",
    XDG_CACHE_HOME: "/synthetic/root/home/cache",
    XDG_DATA_HOME: "/synthetic/root/home/data",
    XDG_STATE_HOME: "/synthetic/root/home/state",
    HTTPS_PROXY: "http://proxy.invalid",
    NO_PROXY: "localhost",
    CODEX_HOME: HOME.config,
    PAGES_CORRELATION: "synthetic",
  });
  expect(environment.SECRET_KEY).toBeUndefined();
  expect(environment.HTTP_PROXY).toBeUndefined();
  expect(environment.PATH.split(path.delimiter)).toContain("/opt/tool/bin");
});

it("uses the process environment when none is given", () => {
  vi.stubEnv("SSL_CERT_FILE", "/synthetic/ca.pem");

  const environment = createCliEnvironment(HOME, "codex_cli", "/opt/cli");

  expect(environment.SSL_CERT_FILE).toBe("/synthetic/ca.pem");
});

it("keeps the dedicated XDG folders of a bound home and the shared toolchain first", () => {
  const environment = createCliEnvironment(
    { ...SHARED, xdgConfig: "/x/config", xdgCache: "/x/cache" },
    "claude_code",
    "/opt/cli",
    {},
  );

  expect(environment.XDG_CONFIG_HOME).toBe("/x/config");
  expect(environment.XDG_CACHE_HOME).toBe("/synthetic/shared/cache");
  expect(environment.PATH.split(path.delimiter)[0]).toBe(
    sharedPnpmBin("/synthetic/shared"),
  );
  expect(environment.PNPM_HOME).toBe("/synthetic/shared/pnpm");
});

it("sets the variables of every provider", () => {
  const result = Object.fromEntries(
    PROVIDERS.map((provider) => [
      provider,
      createCliEnvironment(HOME, provider, "/opt/cli", {}),
    ]),
  );

  expect(result.claude_code).toMatchObject({
    CLAUDE_CONFIG_DIR: HOME.config,
    DISABLE_AUTOUPDATER: "1",
  });
  expect(result.antigravity).toMatchObject({
    GEMINI_HOME: HOME.config,
    TMPDIR: HOME.root,
  });
  expect(result.opencode).toMatchObject({
    XDG_DATA_HOME: HOME.config,
    OPENCODE_PURE: "1",
  });
});

it("limits the native provider environment to the connection folders", () => {
  expect(nativeProviderEnvironment(HOME, "codex_cli")).toEqual({
    CODEX_HOME: HOME.config,
  });
  expect(nativeProviderEnvironment(HOME, "claude_code")).toMatchObject({
    CLAUDE_CONFIG_DIR: HOME.config,
    DISABLE_AUTOUPDATER: "1",
  });
  expect(nativeProviderEnvironment(HOME, "antigravity")).toEqual({
    GEMINI_HOME: HOME.config,
  });
  expect(nativeProviderEnvironment(HOME, "opencode")).toEqual({
    XDG_DATA_HOME: HOME.config,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_SHARE: "1",
  });
});

it("lets a native host environment keep its own variables but accept additions", () => {
  expect(
    createCliRequestEnvironment({
      home: HOME,
      provider: "codex_cli",
      file: "/opt/cli",
      hostEnvironment: { A: "host", B: "host" },
      environment: { B: "request" },
    }),
  ).toEqual({ A: "host", B: "request" });
});

it("starts a request from the allowlist when it has no host environment", () => {
  const environment = createCliRequestEnvironment({
    home: HOME,
    provider: "codex_cli",
    file: "/opt/wrapper/cli",
    toolFile: "/opt/tool/cli",
  });

  expect(environment.PATH.split(path.delimiter)).toContain("/opt/tool");
  expect(environment.PATH.split(path.delimiter)).not.toContain("/opt/wrapper");
});

it("falls back to the file and keeps the shared toolchain before a wrapper PATH", () => {
  const environment = createCliRequestEnvironment({
    home: SHARED,
    provider: "codex_cli",
    file: "/opt/tool/cli",
    environment: { PATH: "/wrapper/bin" },
  });

  expect(environment.PATH.split(path.delimiter)).toEqual([
    sharedPnpmBin("/synthetic/shared"),
    "/wrapper/bin",
  ]);
});

it("quotes embedded apostrophes", () => {
  expect(quoteCliArgument("it's")).toBe("'it'\\''s'");
});

it("builds the terminal command of each CLI with a clean environment", () => {
  const commands = Object.fromEntries(
    PROVIDERS.map((provider) => [
      provider,
      createCliTerminalCommand(HOME, provider, "/opt/cli"),
    ]),
  );

  expect(commands.antigravity).toBe("");
  expect(commands.codex_cli).toContain("'login' '--device-auth'");
  expect(commands.claude_code).toContain("'auth' 'login' '--claudeai'");
  expect(commands.opencode).toContain("'providers' 'login'");
  expect(commands.opencode).toMatch(
    /^umask 077; mkdir -p '\/synthetic\/root\/home' .* cd '\/synthetic\/root\/work' && env -i /u,
  );
});
