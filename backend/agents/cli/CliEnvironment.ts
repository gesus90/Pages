import path from "node:path";

import type { CliProviderId } from "@/definition/AgentConnection";
import type { CliHome } from "./CliContracts";

// OpenCode keeps its key and sessions below XDG_DATA_HOME; every other source of
// configuration, plugins and updates outside the connection folder stays off.
const OPENCODE_SWITCHES = {
  OPENCODE_DISABLE_PROJECT_CONFIG: "1",
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_DISABLE_CLAUDE_CODE: "1",
  OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
  OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
  OPENCODE_DISABLE_SHARE: "1",
  OPENCODE_PURE: "1",
} as const;

function providerEnvironment(
  home: CliHome,
  provider: CliProviderId,
): Record<string, string> {
  switch (provider) {
    case "codex_cli":
      return { CODEX_HOME: home.config };
    case "claude_code":
      return {
        CLAUDE_CONFIG_DIR: home.config,
        DISABLE_AUTOUPDATER: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        // The CLI keeps the exact model it was asked for: no fallback to another model, no remap of a retired name.
        CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK: "1",
        CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP: "1",
      };
    case "opencode":
      return { XDG_DATA_HOME: home.config, ...OPENCODE_SWITCHES };
  }
}

const PROXY_VARIABLES = [
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
] as const;

/** Builds a fresh allowlist; private keys, Node hooks and desktop services never pass through. */
export function createCliEnvironment(
  home: CliHome,
  provider: CliProviderId,
  file: string,
  inherited: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const environment: Record<string, string> = {
    PATH: [
      ...new Set([
        path.dirname(process.execPath),
        path.dirname(file),
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
      ]),
    ].join(path.delimiter),
    HOME: home.home,
    XDG_CONFIG_HOME: path.join(home.home, "config"),
    XDG_CACHE_HOME: path.join(home.home, "cache"),
    XDG_DATA_HOME: path.join(home.home, "data"),
    XDG_STATE_HOME: path.join(home.home, "state"),
    LANG: "C.UTF-8",
    TERM: "dumb",
    NO_COLOR: "1",
  };
  for (const name of PROXY_VARIABLES) {
    if (inherited[name] !== undefined) environment[name] = inherited[name];
  }
  return { ...environment, ...providerEnvironment(home, provider) };
}

/** The arguments of the official sign-in command of each CLI. */
function loginArguments(provider: CliProviderId): readonly string[] {
  switch (provider) {
    case "codex_cli":
      return [
        "login",
        "--device-auth",
        "-c",
        'cli_auth_credentials_store="file"',
        "-c",
        'forced_login_method="chatgpt"',
      ];
    case "claude_code":
      return ["auth", "login", "--claudeai"];
    case "opencode":
      return ["providers", "login"];
  }
}

/** Quotes a path for the optional POSIX terminal command, including embedded apostrophes. */
export function quoteCliArgument(argument: string): string {
  return `'${argument.replaceAll("'", "'\\''")}'`;
}

/** The terminal alternative preserves the same isolation and clears inherited API credentials. */
export function createCliTerminalCommand(
  home: CliHome,
  provider: CliProviderId,
  file: string,
): string {
  const environment = createCliEnvironment(home, provider, file, {});
  const assignments = Object.entries(environment).map(
    ([key, value]) => `${key}=${quoteCliArgument(value)}`,
  );
  const args = loginArguments(provider);
  return `umask 077; mkdir -p ${[home.home, home.config, home.work].map(quoteCliArgument).join(" ")}; cd ${quoteCliArgument(home.work)} && env -i ${assignments.join(" ")} ${[file, ...args].map(quoteCliArgument).join(" ")}`;
}
