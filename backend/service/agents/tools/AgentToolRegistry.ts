import type { CliProviderId } from "@/definition/AgentConnection";
import type { AgentToolId, AgentToolKind } from "@/definition/AgentTools";

/** Trusted installation and health policy; web requests can select only its IDs. */
export interface AgentToolDefinition {
  readonly id: AgentToolId;
  readonly name: string;
  readonly kind: AgentToolKind;
  readonly binary: string;
  readonly packageName: string | null;
  readonly version: string | null;
  readonly versions: readonly string[];
  readonly dependencies: readonly AgentToolId[];
  readonly probe: "version" | "acp" | "mcp" | "browser" | "sandbox";
}

const NODE: AgentToolDefinition = {
  id: "node",
  name: "Node.js",
  kind: "runtime",
  binary: "node",
  packageName: null,
  version: null,
  versions: [">=24.0.0"],
  dependencies: [],
  probe: "version",
};

/** Versions verified on the npm registry; changes require a reviewed registry change. */
export const AGENT_TOOL_REGISTRY: readonly AgentToolDefinition[] = [
  NODE,
  {
    id: "bubblewrap",
    name: "Bubblewrap",
    kind: "sandbox",
    binary: "bwrap",
    packageName: null,
    version: null,
    versions: ["functional namespace probe"],
    dependencies: [],
    probe: "sandbox",
  },
  {
    id: "codex",
    name: "OpenAI Codex CLI",
    kind: "agent",
    binary: "codex",
    packageName: "@openai/codex",
    version: "0.160.0",
    versions: ["0.160.0"],
    dependencies: ["node"],
    probe: "version",
  },
  {
    id: "claude",
    name: "Claude Code CLI",
    kind: "agent",
    binary: "claude",
    packageName: "@anthropic-ai/claude-code",
    version: "2.1.293",
    versions: ["2.1.293"],
    dependencies: ["node"],
    probe: "version",
  },
  {
    id: "opencode",
    name: "OpenCode CLI / native ACP",
    kind: "agent",
    binary: "opencode",
    packageName: "opencode-ai",
    version: "1.18.34",
    versions: ["1.18.34"],
    dependencies: ["node"],
    probe: "version",
  },
  {
    id: "codex_acp",
    name: "Codex ACP",
    kind: "acp",
    binary: "codex-acp",
    packageName: "@agentclientprotocol/codex-acp",
    version: "2.2.2",
    versions: ["2.1.1", "2.2.2"],
    dependencies: ["codex"],
    probe: "acp",
  },
  {
    id: "claude_acp",
    name: "Claude ACP (external)",
    kind: "acp",
    binary: "claude-agent-acp",
    packageName: null,
    version: null,
    versions: ["0.90.0"],
    dependencies: ["claude"],
    probe: "acp",
  },
  {
    id: "pages_mcp",
    name: "Pages MCP",
    kind: "mcp",
    binary: "pages-mcp",
    packageName: null,
    version: null,
    versions: ["bundled"],
    dependencies: ["node"],
    probe: "mcp",
  },
  {
    id: "playwright_mcp",
    name: "Playwright MCP",
    kind: "mcp",
    binary: "playwright-mcp",
    packageName: "@playwright/mcp",
    version: "0.0.83",
    versions: ["0.0.83"],
    dependencies: ["node"],
    probe: "mcp",
  },
  {
    id: "chromium",
    name: "Chromium",
    kind: "browser",
    binary: "chromium",
    packageName: null,
    version: "1.64.0-alpha-1790635538000",
    versions: ["1.64.0-alpha-1790635538000"],
    dependencies: ["playwright_mcp", "bubblewrap"],
    probe: "browser",
  },
  {
    id: "firefox",
    name: "Firefox (optional)",
    kind: "browser",
    binary: "firefox",
    packageName: null,
    version: "1.64.0-alpha-1790635538000",
    versions: ["1.64.0-alpha-1790635538000"],
    dependencies: ["playwright_mcp", "bubblewrap"],
    probe: "browser",
  },
];

/** Resolves only a registry entry, never a request-supplied executable. */
export function agentToolDefinition(id: AgentToolId): AgentToolDefinition {
  const tool = AGENT_TOOL_REGISTRY.find((entry) => entry.id === id);
  if (!tool) throw new Error("Unknown agent tool");
  return tool;
}

/** Provider identity, rather than a model name, determines the native prerequisites. */
export function providerToolIds(
  provider: CliProviderId,
): readonly AgentToolId[] {
  switch (provider) {
    case "codex_cli":
      return ["codex", "codex_acp"];
    case "claude_code":
      return ["claude", "claude_acp"];
    case "opencode":
      return ["opencode"];
  }
}

/** Exact allowlists also apply to adopted system installations. */
export function isAgentToolVersionSupported(
  tool: AgentToolDefinition,
  version: string,
): boolean {
  if (tool.id !== "node") return tool.versions.includes(version);
  const major = Number(version.split(".")[0]);
  return Number.isInteger(major) && major >= 24;
}
