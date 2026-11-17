import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** The application data folder of `agy acp`, below the connection's Gemini folder. */
export const ANTIGRAVITY_APP_DATA_DIRECTORY = "antigravity-acp";

// The CLI keeps its Google sign-in here; the runner checks only that it exists.
const ANTIGRAVITY_TOKEN_FILE = "antigravity-oauth-token";
const ANTIGRAVITY_CONFIGURATION_LIMIT = 65536;

function unmanaged() {
  return Object.assign(new Error("Unmanaged configuration"), {
    pagesCode: "antigravity_configuration_unmanaged",
  });
}

async function contextMetadata(file) {
  try {
    return await lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw unmanaged();
  }
}

async function readSmallFile(file) {
  const metadata = await contextMetadata(file);
  if (metadata === null) return null;
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size > ANTIGRAVITY_CONFIGURATION_LIMIT
  )
    throw unmanaged();
  return readFile(file, "utf8");
}

function isRecord(input) {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

// An MCP configuration without a single server cannot widen a session.
function isEmptyMcpConfiguration(text) {
  if (text.trim() === "") return true;
  const content = JSON.parse(text);
  if (!isRecord(content)) return false;
  const keys = Object.keys(content);
  return (
    keys.length === 0 ||
    (keys.length === 1 &&
      isRecord(content.mcpServers) &&
      Object.keys(content.mcpServers).length === 0)
  );
}

// The CLI's own default: only its built-in plugin switched on or off.
function isDefaultCliConfiguration(text) {
  const content = JSON.parse(text);
  if (!isRecord(content)) return false;
  const keys = Object.keys(content);
  if (keys.length === 0) return true;
  if (keys.length !== 1 || !isRecord(content.plugins)) return false;
  return Object.entries(content.plugins).every(
    ([name, plugin]) =>
      name === "swarm" &&
      isRecord(plugin) &&
      Object.keys(plugin).length === 1 &&
      typeof plugin.enabled === "boolean",
  );
}

function isDefaultConfigurationFile(name, text) {
  if (name === "config.json") return isDefaultCliConfiguration(text);
  if (name === "mcp_config.json") return isEmptyMcpConfiguration(text);
  return false;
}

async function requireDefaultConfiguration(root) {
  const directory = join(root, "config");
  const metadata = await contextMetadata(directory);
  if (metadata === null) return;
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw unmanaged();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".migrated" && entry.isFile()) continue;
    if (entry.name === "projects" && entry.isDirectory()) continue;
    const text = await readSmallFile(join(directory, entry.name));
    let isDefault = false;
    try {
      isDefault = text !== null && isDefaultConfigurationFile(entry.name, text);
    } catch {
      isDefault = false;
    }
    if (!isDefault) throw unmanaged();
  }
}

// A personal sign-in and workspace trust only; nothing that adds tools or servers.
function isPersonalSettings(settings) {
  if (!isRecord(settings)) return false;
  const { auth, trustedWorkspaces, ...rest } = settings;
  return (
    Object.keys(rest).length === 0 &&
    (auth === undefined ||
      (isRecord(auth) &&
        Object.keys(auth).length === 1 &&
        auth.type === "oauth-personal")) &&
    (trustedWorkspaces === undefined ||
      (Array.isArray(trustedWorkspaces) &&
        trustedWorkspaces.every((entry) => typeof entry === "string")))
  );
}

/**
 * Refuses a connection context that could widen the pinned contract.
 *
 * It requires the sign-in of `agy acp` and accepts only what the CLI writes
 * itself: its default `config` folder, a personal sign-in with workspace
 * trust, and no hooks, skills or additional MCP servers, as the Pages host
 * does in backend/agents/acp/AntigravityConfiguration.ts.
 */
export async function requireAntigravityContext(environment, workspace) {
  const root = environment.GEMINI_HOME;
  const directory = await contextMetadata(
    join(root, ANTIGRAVITY_APP_DATA_DIRECTORY),
  );
  if (directory && (!directory.isDirectory() || directory.isSymbolicLink()))
    throw unmanaged();
  const token = await lstat(
    join(root, ANTIGRAVITY_APP_DATA_DIRECTORY, ANTIGRAVITY_TOKEN_FILE),
  ).catch(() => null);
  if (!token?.isFile() || token.isSymbolicLink())
    throw Object.assign(new Error("Login required"), {
      pagesCode: "provider_auth_failed",
    });
  await requireDefaultConfiguration(root);
  for (const name of [
    "antigravity-cli",
    `${ANTIGRAVITY_APP_DATA_DIRECTORY}/hooks.json`,
    `${ANTIGRAVITY_APP_DATA_DIRECTORY}/mcp_config.json`,
  ])
    if (await contextMetadata(join(root, name))) throw unmanaged();
  if (workspace)
    for (const folder of [".agents", ".agent", "_agents", "_agent"])
      if (await contextMetadata(join(workspace, folder, "hooks.json")))
        throw unmanaged();
  const settings = await readSmallFile(
    join(root, ANTIGRAVITY_APP_DATA_DIRECTORY, "settings.json"),
  );
  let isPersonal = false;
  try {
    isPersonal = settings === null || isPersonalSettings(JSON.parse(settings));
  } catch {
    isPersonal = false;
  }
  if (!isPersonal) throw unmanaged();
}
