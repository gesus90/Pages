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

/**
 * The official Node.js distribution on nodejs.org.
 * @remarks
 * The release index names the versions, the release's `SHASUMS256.txt` the
 * digest of the Linux archive. An update stays on the reviewed major line,
 * so the adapters and CLIs started with it keep their runtime contract.
 */
export interface AgentToolNodeSource {
  readonly kind: "node";
  readonly major: number;
}

/**
 * Relocatable CPython builds of a fixed GitHub project.
 * @remarks
 * Every release publishes one `install_only` archive per interpreter and
 * architecture with its SHA-256 digest. An update stays on the reviewed
 * minor line, because scripts and their packages depend on it.
 */
export interface AgentToolPythonSource {
  readonly kind: "python";
  readonly repository: string;
  /** The `major.minor` line an update stays on. */
  readonly line: string;
}

/** A fixed provider source; no web request can name another package, host or URL. */
export type AgentToolReleaseSource =
  | AgentToolNpmSource
  | AgentToolGitHubSource
  | AgentToolNodeSource
  | AgentToolPythonSource;

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
  /**
   * Whether `version` was checked together with the reviewed release of the adapter
   * although the adapter's declared CLI range does not include it.
   * @remarks
   * The adapter drives the CLI through the app-server protocol, so its declared
   * range only names the CLI it bundles. When that range holds a search below
   * `version`, the update search offers the reviewed CLI and adapter releases
   * as one pair; the combination checks of an activation still apply.
   */
  readonly reviewedBeyondAdapterRange?: boolean;
  /** Whether the CLI serves ACP itself, so it needs no separate adapter. */
  readonly hasIntegratedAdapter?: boolean;
  readonly dependencies: readonly AgentToolId[];
  /** `runtime` starts the interpreter with its version flag and a representative script. */
  readonly probe: "version" | "acp" | "mcp" | "browser" | "sandbox" | "runtime";
  /** Publishes a stable `bin/<binary>` link to the active managed generation for the operator's terminal. */
  readonly hasTerminalEntry?: boolean;
}

// Without a managed generation, sessions keep the Node.js that runs Pages; an
// update installs a separate generation that only Pages-managed starts use.
const NODE: AgentToolDefinition = {
  id: "node",
  name: "Node.js",
  kind: "runtime",
  binary: "node",
  packageName: null,
  version: null,
  minimumVersion: "24.0.0",
  release: { kind: "node", major: 24 },
  dependencies: [],
  probe: "runtime",
};

// Interpreter profiles with their own paths stay as they are; only the
// Pages-managed profile starts the managed generation.
const PYTHON: AgentToolDefinition = {
  id: "python",
  name: "Python",
  kind: "runtime",
  binary: "python3",
  packageName: null,
  version: null,
  minimumVersion: "3.10.0",
  release: {
    kind: "python",
    repository: "astral-sh/python-build-standalone",
    line: "3.14",
  },
  dependencies: [],
  probe: "runtime",
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
  PYTHON,
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
    // GPT-6.2 Sol and Astra need a Codex CLI newer than 0.160.0 to be listed.
    // 0.169.0 was checked with codex-acp 2.2.2: its app-server protocol only
    // adds methods, and no method codex-acp 2.2.2 sends lost a field.
    version: "0.169.0",
    minimumVersion: "0.160.0",
    release: { kind: "npm", packageName: "@openai/codex" },
    adapter: "codex_acp",
    reviewedBeyondAdapterRange: true,
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
    // The version flag and the `opencode acp` handshake of the same binary have to agree.
    probe: "acp",
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
  provider: CliProviderId | "openrouter",
): readonly AgentToolId[] {
  switch (provider) {
    case "codex_cli":
      return ["codex", "codex_acp"];
    case "claude_code":
      return ["claude", "claude_acp"];
    case "openrouter":
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
    isArchiveRelease(tool)
  );
}

/** Whether the tool comes as an official archive whose digest the source publishes. */
export function isArchiveRelease(tool: AgentToolDefinition): boolean {
  const kind = tool.release?.kind;
  return kind === "github" || kind === "node" || kind === "python";
}

/**
 * Whether a kept archive address belongs to the fixed official source of a tool.
 * @param tool - The tool whose release names the archive.
 * @param archiveUrl - The address a kept search result names; `null` for an npm package.
 * @remarks
 * The address has to be written in its normal form, so no `..` segment leads
 * out of the source's release folder.
 */
export function isOfficialArchiveUrl(
  tool: AgentToolDefinition,
  archiveUrl: string | null,
): boolean {
  const source = tool.release;
  if (!source || source.kind === "npm") return archiveUrl === null;
  if (archiveUrl === null || !URL.canParse(archiveUrl)) return false;
  const folder =
    source.kind === "node"
      ? "https://nodejs.org/dist/"
      : `https://github.com/${source.repository}/releases/download/`;
  return (
    new URL(archiveUrl).href === archiveUrl && archiveUrl.startsWith(folder)
  );
}

/** The CLI and adapter that change and start only as one checked combination, or `null`. */
export function agentToolPair(tool: AgentToolDefinition): {
  readonly cli: AgentToolDefinition;
  readonly adapter: AgentToolDefinition;
} | null {
  const cli = pairedCli(tool);
  return cli.adapter
    ? { cli, adapter: agentToolDefinition(cli.adapter) }
    : null;
}
