import path from "node:path";

import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { PICA_WORKSPACE_DIRECTORY_NAME } from "@/backend/service/chat/acp/PicaAcpWorkspace";

import type { AgentPlanMcpSettings } from "@/backend/service/agents/AgentPlanSessionAccess";
import type { PicaAcpSettings } from "./chat-services.server";

/**
 * Where plan sessions reach the plan bridge of this instance.
 *
 * @param port - The configured port of this instance.
 * @returns The address of the plan bridge.
 *
 * @remarks
 * `PAGES_AGENT_API_URL` overrides the loopback address of the configured
 * port, for example behind a reverse proxy.
 */
export function planMcpSettings(port: number): AgentPlanMcpSettings {
  return {
    url: configuredValue("PAGES_AGENT_API_URL") ?? `http://127.0.0.1:${port}`,
  };
}

/**
 * Where Pica's Codex sessions reach the tool bridge and keep their working directories.
 *
 * @returns The bridge address and the root of the working directories.
 *
 * @remarks
 * The bridge uses the same local address as the plan bridge of plan nodes.
 * The working directories lie next to the agent folders, outside the folders
 * the isolation hides.
 */
export async function picaAcpSettings(): Promise<PicaAcpSettings> {
  const runtime = await getPagesRuntime();
  const { url } = planMcpSettings(runtime.getConfig().port);
  return {
    bridgeUrl: `${url.replace(/\/$/u, "")}/api/v1/pica-bridge`,
    workspaceRoot: path.join(
      path.dirname(runtime.configFile.path),
      PICA_WORKSPACE_DIRECTORY_NAME,
    ),
  };
}

/** An environment variable with content; empty counts as unset. */
function configuredValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? null : value;
}
