import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { localManagerEnvironment } from "./LocalSessionOwnership";

import type { LocalOwnerManifest } from "./LocalSessionContracts";

const runFile = promisify(execFile);
const OWNER_ENVIRONMENT = [
  "PATH",
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "TMPDIR",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
  "PAGES_GITHUB_TOKEN_KEY",
  "PAGES_CLI_ISOLATION",
  "PAGES_AGENT_API_URL",
  "PAGES_MCP_BUNDLE",
  "PAGES_WORKSPACE_ROOTS",
] as const;

/** Starts a bounded independent product owner; it has no pipe or lifetime dependency on Pages HTTP. */
export async function startLocalSessionUnit(
  manifest: LocalOwnerManifest,
): Promise<void> {
  const entrypoint = fileURLToPath(
    new URL(
      import.meta.env?.PROD
        ? "../../local-agent.mjs"
        : "../../../local-agent.mjs",
      import.meta.url,
    ),
  );
  const environment: Record<string, string> = {
    NODE_ENV: import.meta.env?.PROD ? "production" : "development",
    LANG: "C.UTF-8",
  };
  if (!import.meta.env?.PROD) environment.PAGES_LOCAL_OWNER_SOURCE = "1";
  for (const name of OWNER_ENVIRONMENT) {
    const configured = process.env[name];
    if (configured !== undefined) environment[name] = configured;
  }
  const file = path.join(manifest.directory, "owner.env");
  await writeFile(
    file,
    `${Object.entries(environment)
      .map(([name, value]) => environmentLine(name, value))
      .join("\n")}\n`,
    { flag: "wx", mode: 0o600 },
  );
  const manager = localManagerEnvironment();
  const listed = await runFile(
    "/usr/bin/systemctl",
    ["--user", "show-environment"],
    { env: manager, timeout: 10_000 },
  );
  const unset = listed.stdout
    .split("\n")
    .map((line) => line.slice(0, line.indexOf("=")))
    .filter(
      (name) =>
        /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) &&
        name !== "INVOCATION_ID" &&
        name !== "SYSTEMD_EXEC_PID" &&
        !Object.hasOwn(environment, name),
    );
  const properties = [
    `WorkingDirectory=${path.dirname(entrypoint)}`,
    "MemoryMax=512M",
    "MemorySwapMax=128M",
    // Readiness children and the source-mode compiler share this task budget.
    "TasksMax=256",
    "CPUQuota=100%",
    "OOMPolicy=kill",
    "RuntimeMaxSec=86400",
    "TimeoutStopSec=35s",
    "UMask=0077",
    "Restart=no",
    `EnvironmentFile=${file}`,
    ...(unset.length ? [`UnsetEnvironment=${unset.join(" ")}`] : []),
  ];
  await runFile(
    "/usr/bin/systemd-run",
    [
      "--user",
      "--quiet",
      "--collect",
      "--service-type=exec",
      "--expand-environment=no",
      `--unit=${manifest.unit}`,
      "--slice=pages-acp.slice",
      ...properties.flatMap((property) => ["-p", property]),
      "--",
      process.execPath,
      entrypoint,
      "--config",
      manifest.configPath,
      "--directory",
      manifest.directory,
    ],
    { env: manager, timeout: 15_000 },
  );
}

function environmentLine(name: string, value: string): string {
  if (/[\0\r\n]/u.test(value))
    throw new Error("Invalid local owner environment");
  return `${name}="${value.replace(/[\\"$`]/gu, (character) => `\\${character}`)}"`;
}
