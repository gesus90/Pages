import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";

import { ANTIGRAVITY_APP_DATA_DIRECTORY } from "./AntigravityAcpLaunch";

import type { CliHome } from "@/backend/agents/cli/CliContracts";

/** The largest configuration file Pages reads to decide whether it is the CLI's own default. */
const CONFIGURATION_LIMIT = 65_536;

/** Plugins `agy acp` ships and toggles in its own `config/config.json`. */
const BUILT_IN_PLUGINS: ReadonlySet<string> = new Set(["swarm"]);

/** Settings a personal sign-in and workspace trust write; nothing that adds tools or servers. */
const PERSONAL_SETTING_KEYS: ReadonlySet<string> = new Set([
  "auth",
  "trustedWorkspaces",
]);

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function unmanaged(): AgentError {
  return new AgentError("antigravity_configuration_unmanaged");
}

function isPersonalSettings(content: unknown): boolean {
  if (!record(content)) return false;
  if (!Object.keys(content).every((key) => PERSONAL_SETTING_KEYS.has(key)))
    return false;
  const { auth, trustedWorkspaces } = content;
  const isAuthPersonal =
    auth === undefined ||
    (record(auth) &&
      Object.keys(auth).length === 1 &&
      auth.type === "oauth-personal");
  const isTrustList =
    trustedWorkspaces === undefined ||
    (Array.isArray(trustedWorkspaces) &&
      trustedWorkspaces.every((entry) => typeof entry === "string"));
  return isAuthPersonal && isTrustList;
}

// The CLI's own default: only built-in plugins switched on or off.
function isDefaultCliConfiguration(content: unknown): boolean {
  if (!record(content)) return false;
  const keys = Object.keys(content);
  if (keys.length === 0) return true;
  if (keys.length !== 1 || !record(content.plugins)) return false;
  return Object.entries(content.plugins).every(
    ([name, plugin]) =>
      BUILT_IN_PLUGINS.has(name) &&
      record(plugin) &&
      Object.keys(plugin).length === 1 &&
      typeof plugin.enabled === "boolean",
  );
}

// An MCP configuration without a single server cannot widen a session.
function isEmptyMcpConfiguration(text: string): boolean {
  if (text.trim() === "") return true;
  const content: unknown = JSON.parse(text);
  if (!record(content)) return false;
  const keys = Object.keys(content);
  return (
    keys.length === 0 ||
    (keys.length === 1 &&
      record(content.mcpServers) &&
      Object.keys(content.mcpServers).length === 0)
  );
}

async function readSmallFile(file: string): Promise<string | null> {
  const metadata = await lstat(file).catch((error: unknown) => {
    if (missing(error)) return null;
    throw unmanaged();
  });
  if (metadata === null) return null;
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size > CONFIGURATION_LIMIT
  )
    throw unmanaged();
  return readFile(file, "utf8");
}

async function requirePrivateAcpDirectory(home: CliHome): Promise<void> {
  const metadata = await lstat(
    path.join(home.config, ANTIGRAVITY_APP_DATA_DIRECTORY),
  ).catch((error: unknown) => {
    if (missing(error)) return null;
    throw unmanaged();
  });
  if (metadata && (!metadata.isDirectory() || metadata.isSymbolicLink()))
    throw unmanaged();
}

/**
 * Accepts the global `config` folder only with what `agy acp` writes itself.
 * @remarks
 * The CLI creates it on its first start with built-in plugin switches, an
 * empty MCP configuration, a migration marker and a projects folder. An MCP
 * server, another plugin or any other entry was not written by Pages.
 */
async function requireDefaultCliConfiguration(home: CliHome): Promise<void> {
  const directory = path.join(home.config, "config");
  const metadata = await lstat(directory).catch((error: unknown) => {
    if (missing(error)) return null;
    throw unmanaged();
  });
  if (metadata === null) return;
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw unmanaged();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.name === ".migrated" && entry.isFile()) continue;
    if (entry.name === "projects" && entry.isDirectory()) continue;
    const text = await readSmallFile(file);
    if (text === null) throw unmanaged();
    try {
      if (
        entry.name === "config.json" &&
        isDefaultCliConfiguration(JSON.parse(text))
      )
        continue;
      if (entry.name === "mcp_config.json" && isEmptyMcpConfiguration(text))
        continue;
    } catch {
      throw unmanaged();
    }
    throw unmanaged();
  }
}

async function requireNoWorkspaceHooks(directory: string): Promise<void> {
  for (const folder of [".agents", ".agent", "_agents", "_agent"]) {
    const hook = await lstat(path.join(directory, folder, "hooks.json")).catch(
      (error: unknown) => {
        if (missing(error)) return null;
        throw unmanaged();
      },
    );
    if (hook) throw unmanaged();
  }
}

/** Refuses hooks, skills, extra MCP and settings that can widen the pinned contract. */
export async function requireManagedAntigravityConfiguration(
  home: CliHome,
  directory: string = home.work,
): Promise<void> {
  await requirePrivateAcpDirectory(home);
  await requireDefaultCliConfiguration(home);
  for (const candidate of [
    "antigravity-cli",
    `${ANTIGRAVITY_APP_DATA_DIRECTORY}/hooks.json`,
    `${ANTIGRAVITY_APP_DATA_DIRECTORY}/mcp_config.json`,
  ]) {
    const metadata = await lstat(path.join(home.config, candidate)).catch(
      (error: unknown) => {
        if (missing(error)) return null;
        throw unmanaged();
      },
    );
    if (metadata) throw unmanaged();
  }
  await requireNoWorkspaceHooks(directory);
  try {
    const settings = await readSmallFile(
      path.join(home.config, ANTIGRAVITY_APP_DATA_DIRECTORY, "settings.json"),
    );
    if (settings !== null && !isPersonalSettings(JSON.parse(settings)))
      throw unmanaged();
  } catch {
    throw unmanaged();
  }
}
