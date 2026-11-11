import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { parse } from "smol-toml";

import { logCaughtError } from "@/backend/logging/Logger";

import type { McpServer } from "@agentclientprotocol/sdk";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type {
  AgentDetectedMcpServer,
  AgentMcpTransport,
} from "@/definition/AgentEmployee";

/** One MCP server of the host: what the session receives and what the tab "Zugriff" shows. */
export interface HostMcpServer {
  readonly server: McpServer;
  readonly summary: AgentDetectedMcpServer;
}

/** Reads the MCP servers configured on this host for the CLI of a provider. */
export interface HostMcpDiscovery {
  servers(provider: AgentProviderId | null): Promise<readonly HostMcpServer[]>;
}

/** Where the configuration files lie and how a file is read; tests pass their own. */
export interface HostMcpLocations {
  /** The home folder of the system account Pages runs under. */
  readonly home: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** Reads a file; `null` when it does not exist. */
  readonly read?: (file: string) => Promise<string | null>;
}

type Fields = Readonly<Record<string, unknown>>;

/** Names of the Pages tool servers; a configured server never replaces them. */
const RESERVED_NAMES: ReadonlySet<string> = new Set(["pages", "pages-pica"]);

/** How one configuration file names its servers. */
type ConfigShape = "mcpServers" | "codex" | "opencode";

interface ConfigFile {
  readonly file: string;
  readonly shape: ConfigShape;
}

function fields(value: unknown): Fields | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function texts(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function pairs(value: unknown): { name: string; value: string }[] {
  return Object.entries(fields(value) ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, entry]) => ({ name, value: entry }));
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** A local server started with its command, arguments and environment. */
function stdioServer(
  name: string,
  command: readonly string[],
  environment: unknown,
): McpServer | null {
  const [file, ...args] = command;
  if (file === undefined || file.trim() === "") return null;
  return { name, command: file, args, env: pairs(environment) };
}

/** A remote server reached over HTTP or server-sent events. */
function remoteServer(
  name: string,
  url: string,
  transport: "http" | "sse",
  headers: unknown,
): McpServer {
  return { type: transport, name, url, headers: pairs(headers) };
}

/** `mcpServers` of Claude Code, Gemini and Antigravity: command, args, env or a URL. */
function readMcpServersEntry(name: string, entry: Fields): McpServer | null {
  const command = text(entry.command);
  if (command !== null)
    return stdioServer(name, [command, ...texts(entry.args)], entry.env);
  const url = text(entry.url) ?? text(entry.httpUrl) ?? text(entry.serverUrl);
  if (url === null) return null;
  return remoteServer(
    name,
    url,
    entry.type === "sse" ? "sse" : "http",
    entry.headers,
  );
}

/** `[mcp_servers.<name>]` of Codex: command, args, env or a streamable HTTP URL. */
function readCodexEntry(name: string, entry: Fields): McpServer | null {
  if (entry.enabled === false) return null;
  const command = text(entry.command);
  if (command !== null)
    return stdioServer(name, [command, ...texts(entry.args)], entry.env);
  const url = text(entry.url);
  return url === null
    ? null
    : remoteServer(name, url, "http", entry.http_headers);
}

/** `mcp.<name>` of OpenCode: a local command list or a remote URL. */
function readOpenCodeEntry(name: string, entry: Fields): McpServer | null {
  if (entry.enabled === false) return null;
  if (entry.type === "remote") {
    const url = text(entry.url);
    return url === null ? null : remoteServer(name, url, "http", entry.headers);
  }
  return stdioServer(name, texts(entry.command), entry.environment);
}

function serverTable(document: Fields, shape: ConfigShape): Fields {
  if (shape === "codex") return fields(document.mcp_servers) ?? {};
  if (shape === "opencode") return fields(document.mcp) ?? {};
  return fields(document.mcpServers) ?? {};
}

function readEntry(
  shape: ConfigShape,
  name: string,
  entry: Fields,
): McpServer | null {
  if (shape === "codex") return readCodexEntry(name, entry);
  if (shape === "opencode") return readOpenCodeEntry(name, entry);
  return readMcpServersEntry(name, entry);
}

function transportOf(server: McpServer): AgentMcpTransport {
  if (!("type" in server)) return "stdio";
  return server.type === "sse" ? "sse" : "http";
}

/**
 * The configuration files a provider's CLI reads its user MCP servers from.
 *
 * @remarks
 * Claude Code keeps user servers in `~/.claude.json` (`claude mcp add -s user`),
 * Codex in `$CODEX_HOME/config.toml` or `~/.codex/config.toml`
 * (`codex mcp add`), OpenCode in `$XDG_CONFIG_HOME/opencode/opencode.json`
 * and Antigravity in `~/.gemini/antigravity/mcp_config.json` beside the
 * Gemini settings. Pages starts every CLI with the credential folder of its
 * connection as home, so the CLI itself never sees these files; Pages reads
 * them and hands the servers to the session.
 */
function configFiles(
  provider: AgentProviderId,
  locations: HostMcpLocations,
): readonly ConfigFile[] {
  const { home, environment } = locations;
  const xdgConfig = environment.XDG_CONFIG_HOME ?? path.join(home, ".config");
  switch (provider) {
    case "claude_code":
      return [{ file: path.join(home, ".claude.json"), shape: "mcpServers" }];
    case "codex_cli":
      return [
        {
          file: path.join(
            environment.CODEX_HOME ?? path.join(home, ".codex"),
            "config.toml",
          ),
          shape: "codex",
        },
      ];
    case "opencode":
      return [
        {
          file: path.join(xdgConfig, "opencode", "opencode.json"),
          shape: "opencode",
        },
      ];
    case "antigravity":
      return [
        {
          file: path.join(home, ".gemini", "antigravity", "mcp_config.json"),
          shape: "mcpServers",
        },
        {
          file: path.join(home, ".gemini", "settings.json"),
          shape: "mcpServers",
        },
      ];
    // API providers run no CLI and therefore read no MCP configuration.
    case "openrouter":
    case "openai":
    case "google_ai_studio":
    case "zai":
    case "anthropic":
      return [];
  }
}

async function readOptionalFile(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    )
      return null;
    throw error;
  }
}

/**
 * Finds the MCP servers configured on this host for the CLI of an agent (PAGE-303).
 *
 * @remarks
 * Pages keeps no list of tools or servers of its own: every chat reads the
 * configuration files anew, so a server set up afterwards is part of the next
 * chat without a change of Pages. An unreadable or invalid file is logged
 * and skipped; it never stops a chat. A server named like the Pages tools is
 * left out, so it cannot take their place.
 */
export class CliHostMcpServers implements HostMcpDiscovery {
  private readonly locations: HostMcpLocations;

  public constructor(
    locations: HostMcpLocations = { home: homedir(), environment: process.env },
  ) {
    this.locations = locations;
  }

  /** Every configured server of the provider's CLI, the first file naming a server winning. */
  public async servers(
    provider: AgentProviderId | null,
  ): Promise<readonly HostMcpServer[]> {
    if (provider === null) return [];
    const found = new Map<string, HostMcpServer>();
    for (const config of configFiles(provider, this.locations))
      for (const entry of await this.readConfig(config))
        if (!found.has(entry.summary.name))
          found.set(entry.summary.name, entry);
    return [...found.values()];
  }

  private async readConfig(config: ConfigFile): Promise<HostMcpServer[]> {
    const read = this.locations.read ?? readOptionalFile;
    try {
      const content = await read(config.file);
      if (content === null) return [];
      const document = fields(
        config.shape === "codex" ? parse(content) : JSON.parse(content),
      );
      if (document === null) return [];
      return this.readServers(config, serverTable(document, config.shape));
    } catch (error: unknown) {
      logCaughtError("CliHostMcpServers", error);
      return [];
    }
  }

  private readServers(config: ConfigFile, table: Fields): HostMcpServer[] {
    const source = this.displayPath(config.file);
    const servers: HostMcpServer[] = [];
    for (const [name, value] of Object.entries(table)) {
      const entry = fields(value);
      if (entry === null || RESERVED_NAMES.has(name)) continue;
      const server = readEntry(config.shape, name, entry);
      if (server)
        servers.push({
          server,
          summary: { name, transport: transportOf(server), source },
        });
    }
    return servers;
  }

  private displayPath(file: string): string {
    const { home } = this.locations;
    return file.startsWith(`${home}${path.sep}`)
      ? `~${file.slice(home.length)}`
      : file;
  }
}
