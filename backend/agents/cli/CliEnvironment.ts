import path from "node:path";

import type { CliProviderId } from "@/definition/AgentConnection";
import type { CliHome } from "./CliContracts";

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
  if (provider === "codex_cli") environment.CODEX_HOME = home.config;
  else {
    environment.CLAUDE_CONFIG_DIR = home.config;
    environment.DISABLE_AUTOUPDATER = "1";
    environment.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  }
  return environment;
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
  const args =
    provider === "codex_cli"
      ? [
          "login",
          "--device-auth",
          "-c",
          'cli_auth_credentials_store="file"',
          "-c",
          'forced_login_method="chatgpt"',
        ]
      : ["auth", "login", "--claudeai"];
  return `umask 077; mkdir -p ${[home.home, home.config, home.work].map(quoteCliArgument).join(" ")}; cd ${quoteCliArgument(home.work)} && env -i ${assignments.join(" ")} ${[file, ...args].map(quoteCliArgument).join(" ")}`;
}
