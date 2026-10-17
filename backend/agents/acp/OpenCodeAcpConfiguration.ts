import { lstat } from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { CliHome } from "@/backend/agents/cli/CliContracts";

/**
 * Refuses configuration and instruction sources that the installed native
 * runner can read despite its project-config switch. No content is opened.
 */
export async function requireManagedOpenCodeConfiguration(
  home: CliHome,
): Promise<void> {
  const config = path.join(home.home, "config", "opencode");
  const directory = await lstat(config).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    logCaughtError("OpenCodeAcpConfiguration", error);
    throw new AgentError("opencode_configuration_unmanaged");
  });
  if (
    directory !== null &&
    (!directory.isDirectory() || directory.isSymbolicLink())
  )
    throw new AgentError("opencode_configuration_unmanaged");
  const candidates = [
    ...[
      "config.json",
      "config",
      "opencode.json",
      "opencode.jsonc",
      "AGENTS.md",
      "agent",
      "agents",
      "command",
      "commands",
      "plugin",
      "plugins",
      "skills",
    ].map((name) => path.join(config, name)),
    path.join(home.home, ".opencode"),
    "/etc/opencode/opencode.json",
    "/etc/opencode/opencode.jsonc",
  ];
  for (const candidate of candidates) {
    try {
      await lstat(candidate);
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        continue;
      logCaughtError("OpenCodeAcpConfiguration", error);
      throw new AgentError("opencode_configuration_unmanaged");
    }
    throw new AgentError("opencode_configuration_unmanaged");
  }
}
