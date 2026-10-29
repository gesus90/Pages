import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";

import type { CliHome } from "@/backend/agents/cli/CliContracts";

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isPersonalSettings(content: unknown): boolean {
  if (
    typeof content !== "object" ||
    content === null ||
    Object.keys(content).length !== 1 ||
    !("auth" in content)
  )
    return false;
  const auth = content.auth;
  return (
    typeof auth === "object" &&
    auth !== null &&
    Object.keys(auth).length === 1 &&
    "type" in auth &&
    auth.type === "oauth-personal"
  );
}

async function requirePrivateAcpDirectory(home: CliHome): Promise<void> {
  const metadata = await lstat(path.join(home.config, "antigravity-acp")).catch(
    (error: unknown) => {
      if (missing(error)) return null;
      throw new AgentError("antigravity_configuration_unmanaged");
    },
  );
  if (metadata && (!metadata.isDirectory() || metadata.isSymbolicLink()))
    throw new AgentError("antigravity_configuration_unmanaged");
}

/** Refuses hooks, skills, extra MCP and settings that can widen the pinned contract. */
export async function requireManagedAntigravityConfiguration(
  home: CliHome,
  directory: string = home.work,
): Promise<void> {
  await requirePrivateAcpDirectory(home);
  for (const candidate of [
    "config",
    "antigravity-cli",
    "antigravity-acp/hooks.json",
    "antigravity-acp/mcp_config.json",
  ]) {
    const metadata = await lstat(path.join(home.config, candidate)).catch(
      (error: unknown) => {
        if (missing(error)) return null;
        throw new AgentError("antigravity_configuration_unmanaged");
      },
    );
    if (metadata) throw new AgentError("antigravity_configuration_unmanaged");
  }
  for (const folder of [".agents", ".agent", "_agents", "_agent"]) {
    const hook = await lstat(path.join(directory, folder, "hooks.json")).catch(
      (error: unknown) => {
        if (missing(error)) return null;
        throw new AgentError("antigravity_configuration_unmanaged");
      },
    );
    if (hook) throw new AgentError("antigravity_configuration_unmanaged");
  }
  const settings = path.join(home.config, "antigravity-acp", "settings.json");
  try {
    const metadata = await lstat(settings);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 4096)
      throw new AgentError("antigravity_configuration_unmanaged");
    const content: unknown = JSON.parse(await readFile(settings, "utf8"));
    if (!isPersonalSettings(content))
      throw new AgentError("antigravity_configuration_unmanaged");
  } catch (error: unknown) {
    if (!missing(error))
      throw new AgentError("antigravity_configuration_unmanaged");
  }
}
