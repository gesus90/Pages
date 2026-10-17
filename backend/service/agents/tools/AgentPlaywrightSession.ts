import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";

import { containsWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";

import { AgentToolReadinessError } from "./AgentToolReadinessError";

import type { McpServerStdio } from "@agentclientprotocol/sdk";
import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AgentToolId } from "@/definition/AgentTools";
import type { AgentToolLocation } from "./AgentToolContracts";

/** Builds only the explicitly authorized plan session's isolated browser MCP entry. */
export async function agentPlaywrightServer(
  input: AgentPlanSessionInput,
  locations: ReadonlyMap<AgentToolId, AgentToolLocation>,
): Promise<McpServerStdio | null> {
  if (input.options.browser !== true || input.chat) return null;
  if (input.options.access !== "yolo")
    throw new AgentToolReadinessError(
      "playwright_mcp",
      "unsupported",
      "browser_permission_required",
    );
  const mcp = locations.get("playwright_mcp");
  const chromium = locations.get("chromium");
  if (!mcp || !chromium?.release)
    throw new AgentToolReadinessError(
      "chromium",
      "missing_dependency",
      "not_installed",
    );
  const output = await artifactDirectory(input.directory, input.instanceId);
  return {
    name: "playwright",
    command: mcp.file,
    args: [
      "--headless",
      "--browser",
      "chromium",
      "--isolated",
      "--sandbox",
      "--save-session",
      "--output-dir",
      output,
    ],
    env: [
      {
        name: "PLAYWRIGHT_BROWSERS_PATH",
        value: path.join(chromium.release, "browsers"),
      },
      { name: "PAGES_RUN_INSTANCE", value: input.instanceId },
      { name: "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", value: "1" },
    ],
  };
}

async function artifactDirectory(
  workspace: string,
  instanceId: string,
): Promise<string> {
  if (!/^[\w-]+$/u.test(instanceId))
    throw new Error("Invalid browser session identifier");
  const root = path.join(workspace, ".pages-artifacts");
  await createDirectory(root);
  const output = path.join(root, instanceId);
  await createDirectory(output);
  if (!containsWorkspacePath(await realpath(workspace), await realpath(output)))
    throw new Error("Browser output outside workspace");
  return output;
}

async function createDirectory(directory: string): Promise<void> {
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
  }
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error("Unsafe browser output directory");
}
