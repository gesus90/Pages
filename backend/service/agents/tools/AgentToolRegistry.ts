import { isStableVersionAtLeast } from "@/definition/AgentToolVersion";

import type { CliProviderId } from "@/definition/AgentConnection";
import type { AgentToolId, AgentToolKind } from "@/definition/AgentTools";

/** The official npm registry entry of a package; only its release metadata is read. */
export interface AgentToolNpmSource {
  readonly kind: "npm";
  readonly packageName: string;
}

/** The official GitHub release of a provider, with one archive per Linux architecture. */
export interface AgentToolGitHubSource {
  readonly kind: "github";
  readonly repository: string;
  readonly assets: Readonly<Partial<Record<NodeJS.Architecture, string>>>;
  /** The program inside the archive, published as the tool's binary. */
  readonly member: string;
}

/** A fixed provider source; no web request can name another package, host or URL. */
export type AgentToolReleaseSource = AgentToolNpmSource | AgentToolGitHubSource;

/** Trusted installation and health policy; web requests can select only its IDs. */
export interface AgentToolDefinition {
  readonly id: AgentToolId;
  readonly name: string;
  readonly kind: AgentToolKind;
  readonly binary: string;
  readonly packageName: string | null;
  /** The release Pages installs while no update check selected a newer compatible one. */
  readonly version: string | null;
  /** The oldest stable release whose protocol and options Pages implements. */
  readonly minimumVersion: string | null;
  /** Where "Updates suchen" reads release metadata; `null` keeps the tool at `version`. */
  readonly release: AgentToolReleaseSource | null;
  /** The adapter a CLI needs; CLI and adapter are updated as one checked combination. */
  readonly adapter?: AgentToolId;
  /** Whether the CLI serves ACP itself, so it needs no separate adapter. */
  readonly hasIntegratedAdapter?: boolean;
  readonly dependencies: readonly AgentToolId[];
  readonly probe: "version" | "acp" | "mcp" | "browser" | "sandbox";
  /** Publishes a stable `bin/<binary>` link to the active managed generation for the operator's terminal. */
  readonly hasTerminalEntry?: boolean;
}

const NODE: AgentToolDefinition = {
  id: "node",
  name: "Node.js",
  kind: "runtime",
  binary: "node",
  packageName: null,
  version: null,
  minimumVersion: "24.0.0",
  release: null,
  dependencies: [],
  probe: "version",
};

const PLAYWRIGHT_REVISION = "1.64.0-alpha-1790635538000";

/**
 * Reviewed providers and their fixed official release sources.
 * @remarks
 * A new stable release of a source needs no change here: it is installed as
 * a separate candidate and activated only after its version, protocol and
 * CLI/adapter combination passed the model-free checks. Browser runtimes stay
 * on the revision their Playwright release names.
 */
export const AGENT_TOOL_REGISTRY: readonly AgentToolDefinition[] = [
  NODE,
  {
    id: "bubblewrap",
    name: "Bubblewrap",
    kind: "sandbox",
    binary: "bwrap",
    packageName: null,
    version: null,
    minimumVersion: null,
    release: null,
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
    minimumVersion: "0.160.0",
    release: { kind: "npm", packageName: "@openai/codex" },
    adapter: "codex_acp",
    dependencies: ["node"],
    probe: "version",
  },
  {
    id: "claude",
    name: "Claude Code CLI",
    kind: "agent",
    binary: "claude",
    packageName: "@anthropic-ai/claude-code",
    // Fable 5.2 needs 2.1.321 or later.
    version: "2.1.322",
    minimumVersion: "2.1.321",
    release: { kind: "npm", packageName: "@anthropic-ai/claude-code" },
    adapter: "claude_acp",
    dependencies: ["node"],
    probe: "version",
    hasTerminalEntry: true,
  },
  {
    id: "opencode",
    name: "OpenCode CLI / native ACP",
    kind: "agent",
    binary: "opencode",
    packageName: "opencode-ai",
    version: "1.18.34",
    minimumVersion: "1.18.34",
    release: { kind: "npm", packageName: "opencode-ai" },
    hasIntegratedAdapter: true,
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
    minimumVersion: "2.1.1",
    release: { kind: "npm", packageName: "@agentclientprotocol/codex-acp" },
    dependencies: ["codex"],
    probe: "acp",
  },
  {
    id: "claude_acp",
    name: "Claude ACP",
    kind: "acp",
    binary: "claude-agent-acp",
    packageName: "@agentclientprotocol/claude-agent-acp",
    version: "0.90.0",
    minimumVersion: "0.90.0",
    release: {
      kind: "npm",
      packageName: "@agentclientprotocol/claude-agent-acp",
    },
    dependencies: ["claude"],
    probe: "acp",
  },
  {
    id: "antigravity_acp",
    name: "Google Antigravity CLI (agy acp)",
    kind: "agent",
    binary: "agy",
    packageName: null,
    version: "1.5.9",
    // `agy acp` is the official ACP entry point from this release on.
    minimumVersion: "1.5.9",
    release: {
      kind: "github",
      repository: "google-antigravity/antigravity-cli",
      assets: {
        x64: "agy_cli_linux_x64.tar.gz",
        arm64: "agy_cli_linux_arm64.tar.gz",
      },
      member: "antigravity",
    },
    hasIntegratedAdapter: true,
    dependencies: [],
    probe: "acp",
  },
  {
    id: "playwright_mcp",
    name: "Playwright MCP",
    kind: "mcp",
    binary: "playwright-mcp",
    packageName: "@playwright/mcp",
    version: "0.0.83",
    minimumVersion: null,
    release: null,
    dependencies: ["node"],
    probe: "mcp",
  },
  {
    id: "chromium",
    name: "Chromium",
    kind: "browser",
    binary: "chromium",
    packageName: null,
    version: PLAYWRIGHT_REVISION,
    minimumVersion: null,
    release: null,
    dependencies: ["playwright_mcp", "bubblewrap"],
    probe: "browser",
  },
  {
    id: "firefox",
    name: "Firefox (optional)",
    kind: "browser",
    binary: "firefox",
    packageName: null,
    version: PLAYWRIGHT_REVISION,
    minimumVersion: null,
    release: null,
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
  provider: CliProviderId | "openrouter" | "zai",
): readonly AgentToolId[] {
  switch (provider) {
    case "codex_cli":
      return ["codex", "codex_acp"];
    case "claude_code":
      return ["claude", "claude_acp"];
    case "openrouter":
    case "zai":
    case "opencode":
      return ["opencode"];
    case "antigravity":
      return ["antigravity_acp"];
  }
}

/** The connection provider whose sessions start this CLI or adapter, if any. */
export function toolProvider(id: AgentToolId): CliProviderId | null {
  const providers: readonly CliProviderId[] = [
    "codex_cli",
    "claude_code",
    "opencode",
    "antigravity",
  ];
  return (
    providers.find((provider) => providerToolIds(provider).includes(id)) ?? null
  );
}

/** The CLI an adapter belongs to, or the tool itself when it is a CLI. */
export function pairedCli(tool: AgentToolDefinition): AgentToolDefinition {
  const owner = AGENT_TOOL_REGISTRY.find((entry) => entry.adapter === tool.id);
  return owner ?? tool;
}

/**
 * Whether a version may run: a stable release at or above the minimum.
 * @remarks
 * A tool without a release source stays on its exact reviewed version. The
 * rule also applies to adopted system installations; the protocol probe
 * decides the rest of the compatibility.
 */
export function isAgentToolVersionSupported(
  tool: AgentToolDefinition,
  version: string,
): boolean {
  if (tool.minimumVersion !== null)
    return isStableVersionAtLeast(version, tool.minimumVersion);
  return tool.version === version;
}

/** Whether Pages can provision this reviewed package, browser or official binary distribution. */
export function isAgentToolInstallable(tool: AgentToolDefinition): boolean {
  return (
    tool.packageName !== null ||
    tool.kind === "browser" ||
    tool.release?.kind === "github"
  );
}
