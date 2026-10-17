import path from "node:path";
import { homedir } from "node:os";
import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";

import {
  pagesMcpBundlePath,
  PAGES_MCP_VERSION,
} from "@/backend/agents/cli/PagesMcpBundle";
import { containsWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";

import { AgentToolFiles } from "./AgentToolFiles";
import { AgentToolHealthService } from "./AgentToolHealthService";
import { AgentToolInstaller } from "./AgentToolInstaller";
import { AgentToolManagerService } from "./AgentToolManagerService";
import { agentToolDefinition } from "./AgentToolRegistry";

import type { CliLocator } from "@/backend/agents/cli/CliLocator";
import type { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import type { AgentToolDefinition } from "./AgentToolRegistry";
import type { AgentToolLocation } from "./AgentToolContracts";

/** Composes the manager with the existing process runner and a file-only system locator. */
export function createAgentToolManager(input: {
  readonly instanceDirectory: string;
  readonly locator: CliLocator;
  readonly runner: CliProcessRunner;
}): AgentToolManagerService {
  const files = new AgentToolFiles(path.join(input.instanceDirectory, "tools"));
  const system = async (
    tool: AgentToolDefinition,
  ): Promise<AgentToolLocation | null> => {
    if (tool.kind === "browser") return null;
    if (tool.id === "node")
      return {
        file: process.execPath,
        source: "system",
        release: null,
        version: process.versions.node,
      };
    if (tool.id === "bubblewrap")
      return builtInLocation("/usr/bin/bwrap", "system", null);
    if (tool.id === "pages_mcp")
      return builtInLocation(
        pagesMcpBundlePath(),
        "bundled",
        PAGES_MCP_VERSION,
      );
    const location = await input.locator.locate(tool.binary);
    if (location.path && !(await isTrustedSystemLocation(location.path)))
      return null;
    return location.path
      ? { file: location.path, source: "system", release: null, version: null }
      : null;
  };
  const resolve = async (
    id: "playwright_mcp" | "codex" | "claude",
  ): Promise<AgentToolLocation | null> => {
    const tool = agentToolDefinition(id);
    return (await files.current(tool)) ?? (await system(tool));
  };
  return new AgentToolManagerService({
    files,
    system,
    activities: (id) => input.runner.toolActivities(path.join(files.root, id)),
    installer: new AgentToolInstaller({
      files,
      locator: input.locator,
      runner: input.runner,
      resolve,
    }),
    health: new AgentToolHealthService({
      files,
      runner: input.runner,
      resolve,
    }),
  });
}

async function isTrustedSystemLocation(file: string): Promise<boolean> {
  const target = await realpath(file);
  if (!containsWorkspacePath(homedir(), target)) return true;
  return (
    containsWorkspacePath(path.dirname(process.execPath), target) ||
    containsWorkspacePath(
      path.join(
        path.dirname(path.dirname(process.execPath)),
        "lib",
        "node_modules",
      ),
      target,
    )
  );
}

async function builtInLocation(
  file: string,
  source: "system" | "bundled",
  version: string | null,
): Promise<AgentToolLocation | null> {
  try {
    await access(file, source === "bundled" ? constants.R_OK : constants.X_OK);
    return { file, source, version, release: null };
  } catch {
    return null;
  }
}
