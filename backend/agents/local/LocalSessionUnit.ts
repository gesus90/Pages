import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { AgentError } from "@/backend/error/AgentErrors";
import { omitSystemdServiceEnvironment } from "@/backend/agents/SystemdServiceEnvironment";

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
  "PAGES_FULL_ENVIRONMENT_OWNER_ID",
  "PAGES_AGENT_API_URL",
  "PAGES_WORKSPACE_ROOTS",
] as const;

/** Starts a bounded independent product owner; it has no pipe or lifetime dependency on Pages HTTP. */
export async function startLocalSessionUnit(
  manifest: LocalOwnerManifest,
): Promise<void> {
  const builtEntrypoint = fileURLToPath(
    new URL("../../local-agent.mjs", import.meta.url),
  );
  const isBuilt = existsSync(builtEntrypoint);
  const entrypoint = isBuilt
    ? builtEntrypoint
    : path.resolve(process.cwd(), "local-agent.mjs");
  const environment: Record<string, string> = {
    NODE_ENV: isBuilt ? "production" : "development",
    LANG: "C.UTF-8",
  };
  if (!isBuilt) environment.PAGES_LOCAL_OWNER_SOURCE = "1";
  for (const name of OWNER_ENVIRONMENT) {
    const configured = process.env[name];
    if (configured !== undefined) environment[name] = configured;
  }
  if (manifest.launch.isFullEnvironment)
    Object.assign(environment, omitSystemdServiceEnvironment(process.env));
  const file = path.join(manifest.directory, "owner.env");
  await writeFile(
    file,
    `${Object.entries(environment)
      .map(([name, value]) =>
        environmentLine(
          name,
          value,
          manifest.launch.isFullEnvironment === true,
        ),
      )
      .join("\n")}\n`,
    { flag: "wx", mode: 0o600 },
  );
  try {
    await startPreparedLocalSessionUnit({
      manifest,
      file,
      entrypoint,
      environment,
      isBuilt,
    });
  } catch {
    // Process errors may include captured environment output; never forward them.
    try {
      await rm(file, { force: true });
    } catch {
      throw new AgentError("credential_cleanup_failed");
    }
    throw new AgentError("plan_local_launch_invalid");
  }
}

interface PreparedLocalUnitOptions {
  readonly manifest: LocalOwnerManifest;
  readonly file: string;
  readonly entrypoint: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly isBuilt: boolean;
}

async function startPreparedLocalSessionUnit(
  options: PreparedLocalUnitOptions,
): Promise<void> {
  const { manifest, file, entrypoint, environment, isBuilt } = options;
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
    `MemoryMax=${isBuilt ? "512M" : "1536M"}`,
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

function environmentLine(
  name: string,
  value: string,
  isFullEnvironment = false,
): string {
  if ((isFullEnvironment ? /[\0\r]/u : /[\0\r\n]/u).test(value))
    throw new Error("Invalid local owner environment");
  return `${name}="${value.replace(/[\\"$`]/gu, (character) => `\\${character}`)}"`;
}
