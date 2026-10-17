import { randomUUID } from "node:crypto";

import { constants } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
  endTaggedProcesses,
  readServerScope,
} from "@/backend/agents/cli/CliProcessScan";
import { probeBubblewrap } from "@/backend/agents/cli/CliPlanIsolation";

import { isAgentToolVersionSupported } from "./AgentToolRegistry";
import { AgentToolProtocolProbe } from "./AgentToolProtocolProbe";

import type { CliProviderId } from "@/definition/AgentConnection";
import type { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import type { AgentToolDefinition } from "./AgentToolRegistry";
import type {
  AgentToolHealth,
  AgentToolHealthChecks,
  AgentToolLocation,
  AgentToolStorage,
} from "./AgentToolContracts";

/** Uses the package's own pinned browser revision, without downloading during a check. */
export const BROWSER_PROBE_SCRIPT = `
const { createRequire } = require('node:module');
const load = createRequire(require('node:fs').realpathSync(process.env.PAGES_PLAYWRIGHT_ENTRY));
const playwright = load('playwright');
(async () => {
  const browser = await playwright[process.env.PAGES_BROWSER].launch({ headless: true, ...(process.env.PAGES_BROWSER === "chromium" ? { chromiumSandbox: true } : {}) });
  try { const page = await browser.newPage(); await page.goto('about:blank'); process.stdout.write(JSON.stringify({ version: browser.version(), playwrightVersion: load('playwright/package.json').version })); }
  finally { await browser.close(); }
})().catch((error) => {
  if (error instanceof Error && /Chromium sandboxing failed|No usable sandbox/u.test(error.message)) process.stdout.write('browser_sandbox_unavailable');
  process.exitCode = 1;
});
`;

const READY: AgentToolHealth = {
  status: "ready",
  diagnostic: "ready",
  version: null,
};

/** Performs bounded local probes with an empty Pages-owned home and no model call. */
export class AgentToolHealthService implements AgentToolHealthChecks {
  private readonly files: AgentToolStorage;
  private readonly runner: Pick<CliProcessRunner, "run" | "startSession">;
  private readonly resolve: (
    id: "playwright_mcp" | "codex" | "claude",
  ) => Promise<AgentToolLocation | null>;

  public constructor(input: {
    readonly files: AgentToolStorage;
    readonly runner: Pick<CliProcessRunner, "run" | "startSession">;
    readonly resolve: (
      id: "playwright_mcp" | "codex" | "claude",
    ) => Promise<AgentToolLocation | null>;
  }) {
    this.files = input.files;
    this.runner = input.runner;
    this.resolve = input.resolve;
  }

  /** Checks executable permissions, compatibility and the relevant functional contract. */
  public async check(
    tool: AgentToolDefinition,
    location: AgentToolLocation,
    signal: AbortSignal,
  ): Promise<AgentToolHealth> {
    try {
      signal.throwIfAborted();
      if (tool.probe === "sandbox") return await this.sandbox();
      if (tool.probe === "browser") {
        await access(location.file, constants.X_OK);
        return await this.browser(tool, location, signal);
      }
      await access(
        location.file,
        tool.id === "pages_mcp" ? constants.R_OK : constants.X_OK,
      );
      if (tool.probe === "acp" || tool.probe === "mcp")
        return await this.protocol(tool, location, signal);
      return await this.version(tool, location, signal);
    } catch (error: unknown) {
      const isDenied =
        error instanceof Error && "code" in error && error.code === "EACCES";
      return {
        status: "failed",
        diagnostic: isDenied ? "permission_denied" : "execution_failed",
        version: null,
      };
    }
  }

  private async version(
    tool: AgentToolDefinition,
    location: AgentToolLocation,
    signal: AbortSignal,
  ): Promise<AgentToolHealth> {
    const result = await this.runner.run({
      file: location.file,
      arguments: ["--version"],
      provider: healthProvider(tool),
      home: await this.files.home(),
      stdin: "ignore",
      signal,
      timeoutMs: 10_000,
    });
    const version =
      result.stdout.match(/\bv?(\d+\.\d+\.\d+(?:-[\w.-]+)?)\b/u)?.[1] ?? null;
    if (result.errorCode || result.exitCode !== 0 || version === null)
      return { status: "failed", diagnostic: "execution_failed", version };
    return isAgentToolVersionSupported(tool, version)
      ? { ...READY, version }
      : { status: "unsupported", diagnostic: "version_unsupported", version };
  }

  private async sandbox(): Promise<AgentToolHealth> {
    return (await probeBubblewrap())
      ? READY
      : {
          status: "missing_dependency",
          diagnostic: "sandbox_unavailable",
          version: null,
        };
  }

  private async protocol(
    tool: AgentToolDefinition,
    location: AgentToolLocation,
    signal: AbortSignal,
  ): Promise<AgentToolHealth> {
    const runner = tool.id === "codex_acp" ? await this.resolve("codex") : null;
    const claude =
      tool.id === "claude_acp" ? await this.resolve("claude") : null;
    const reported = await new AgentToolProtocolProbe(this.runner).check({
      tool,
      file: location.file,
      home: await this.files.home(),
      signal,
      environment: {
        ...(runner ? { CODEX_PATH: runner.file } : {}),
        ...(claude ? { CLAUDE_CODE_EXECUTABLE: claude.file } : {}),
      },
    });
    if (!reported)
      return {
        status: "failed",
        diagnostic: "handshake_failed",
        version: null,
      };
    const version =
      tool.id === "playwright_mcp"
        ? await this.packageVersion(tool, location)
        : reported;
    if (
      version === null ||
      (tool.id !== "pages_mcp" && !isAgentToolVersionSupported(tool, version))
    )
      return {
        status: "unsupported",
        diagnostic: "version_unsupported",
        version,
      };
    return { ...READY, version };
  }

  private async packageVersion(
    tool: AgentToolDefinition,
    location: AgentToolLocation,
  ): Promise<string | null> {
    const directory = location.release
      ? path.join(location.release, "node_modules", "@playwright", "mcp")
      : path.dirname(await realpath(location.file));
    const manifest: unknown = JSON.parse(
      await readFile(path.join(directory, "package.json"), "utf8"),
    );
    return typeof manifest === "object" &&
      manifest !== null &&
      "name" in manifest &&
      manifest.name === tool.packageName &&
      "version" in manifest &&
      typeof manifest.version === "string"
      ? manifest.version
      : null;
  }

  private async browser(
    tool: AgentToolDefinition,
    location: AgentToolLocation,
    signal: AbortSignal,
  ): Promise<AgentToolHealth> {
    const mcp = await this.resolve("playwright_mcp");
    if (!mcp || !location.release)
      return {
        status: "missing_dependency",
        diagnostic: "not_installed",
        version: null,
      };
    const instanceId = randomUUID();
    const result = await this.runner.run({
      file: process.execPath,
      arguments: ["-e", BROWSER_PROBE_SCRIPT],
      provider: "codex_cli",
      home: await this.files.home(),
      environment: {
        TMPDIR: path.join(this.files.root, "probe"),
        PAGES_RUN_INSTANCE: instanceId,
        PAGES_PLAYWRIGHT_ENTRY: mcp.file,
        PAGES_BROWSER: tool.id,
        PLAYWRIGHT_BROWSERS_PATH: path.join(location.release, "browsers"),
      },
      signal,
      stdin: "ignore",
      timeoutMs: 20_000,
    });
    const cleanup = await endTaggedProcesses(
      instanceId,
      await readServerScope(),
    );
    if (cleanup.remaining > 0)
      return {
        status: "failed",
        diagnostic: "active_sessions",
        version: tool.version,
      };
    const reported = readBrowserVersion(result.stdout, tool.version);
    if (result.exitCode === 0 && result.errorCode === null && reported !== null)
      return { ...READY, version: tool.version, runtimeVersion: reported };
    return {
      status: "missing_dependency",
      diagnostic:
        result.stdout.trim() === "browser_sandbox_unavailable"
          ? "browser_sandbox_unavailable"
          : "browser_failed",
      version: tool.version,
    };
  }
}

function healthProvider(tool: AgentToolDefinition): CliProviderId {
  if (tool.id === "claude") return "claude_code";
  if (tool.id === "opencode") return "opencode";
  return "codex_cli";
}

function readBrowserVersion(
  stdout: string,
  expected: string | null,
): string | null {
  try {
    const reported: unknown = JSON.parse(stdout);
    if (
      typeof reported !== "object" ||
      reported === null ||
      !("version" in reported) ||
      typeof reported.version !== "string" ||
      !("playwrightVersion" in reported) ||
      reported.playwrightVersion !== expected ||
      !/^\d+(?:\.\d+){1,3}$/u.test(reported.version)
    )
      return null;
    return reported.version;
  } catch {
    return null;
  }
}
