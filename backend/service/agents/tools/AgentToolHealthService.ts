import { randomUUID } from "node:crypto";

import { constants } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { probeBubblewrap } from "@/backend/agents/cli/CliPlanIsolation";
import { logEvent } from "@/backend/logging/Logger";

import { isAgentToolVersionSupported } from "./AgentToolRegistry";
import { AgentToolProtocolProbe } from "./AgentToolProtocolProbe";
import { AgentToolReadinessError } from "./AgentToolReadinessError";
import { AgentToolRunFiles } from "./AgentToolRunFiles";

import type { CliProviderId } from "@/definition/AgentConnection";
import type { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import type { AgentToolDefinition } from "./AgentToolRegistry";
import type {
  AgentToolHealth,
  AgentToolHealthChecks,
  AgentToolLocation,
  AgentToolStorage,
  AgentToolRunContext,
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

/** The scratch directory of one check and the CLI generation an adapter is checked with. */
interface CheckContext extends AgentToolRunContext {
  readonly cli?: AgentToolLocation;
}

const READY: AgentToolHealth = {
  status: "ready",
  diagnostic: "ready",
  version: null,
};

function isFileAccessDenied(error: unknown, file: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EACCES" || error.code === "EPERM") &&
    "syscall" in error &&
    error.syscall === "access" &&
    "path" in error &&
    error.path === file
  );
}

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
    cli?: AgentToolLocation,
  ): Promise<AgentToolHealth> {
    try {
      return await new AgentToolRunFiles(this.files).temporary(
        (temporaryDirectory) =>
          this.inspect(tool, location, { signal, temporaryDirectory, cli }),
      );
    } catch (error: unknown) {
      if (error instanceof AgentToolReadinessError)
        return {
          status: error.status,
          diagnostic: error.diagnostic,
          version: null,
        };
      return {
        status: "failed",
        diagnostic: isFileAccessDenied(error, location.file)
          ? "permission_denied"
          : "execution_failed",
        version: null,
      };
    }
  }

  private async inspect(
    tool: AgentToolDefinition,
    location: AgentToolLocation,
    control: CheckContext,
  ): Promise<AgentToolHealth> {
    control.signal.throwIfAborted();
    if (tool.probe === "sandbox") return this.sandbox(control);
    await access(location.file, constants.X_OK);
    if (tool.probe === "browser") return this.browser(tool, location, control);
    if (tool.hasIntegratedAdapter && tool.probe === "acp")
      return this.integrated(tool, location, control);
    if (tool.probe === "acp" || tool.probe === "mcp")
      return this.protocol(tool, location, control);
    return this.version(tool, location, control);
  }

  // A CLI with its own ACP entry point: the started binary's version and its handshake must agree.
  private async integrated(
    tool: AgentToolDefinition,
    location: AgentToolLocation,
    control: CheckContext,
  ): Promise<AgentToolHealth> {
    const cli = await this.version(tool, location, control);
    if (cli.status !== "ready") return cli;
    const handshake = await this.protocol(tool, location, control);
    if (handshake.status !== "ready") return handshake;
    return handshake.version === cli.version
      ? handshake
      : {
          status: "unsupported",
          diagnostic: "version_unsupported",
          version: cli.version,
        };
  }

  private async version(
    tool: AgentToolDefinition,
    location: AgentToolLocation,
    control: AgentToolRunContext,
  ): Promise<AgentToolHealth> {
    const result = await this.runner.run({
      file: location.file,
      arguments: ["--version"],
      provider: healthProvider(tool),
      home: await this.files.home(),
      stdin: "ignore",
      environment: { TMPDIR: control.temporaryDirectory },
      signal: control.signal,
      timeoutMs: 10_000,
    });
    const version =
      result.stdout.match(/\bv?(\d+\.\d+\.\d+(?:-[\w.-]+)?)\b/u)?.[1] ?? null;
    if (result.errorCode || result.exitCode !== 0 || version === null) {
      // The diagnostic alone cannot tell a refused start from a failing binary.
      logEvent({
        level: "warn",
        event: "agent.tool.probe_failed",
        component: "AgentToolHealthService",
        message: "The version probe of an agent tool did not report a version",
        metadata: {
          tool: tool.id,
          code: result.errorCode,
          exitCode: result.exitCode,
        },
      });
      return { status: "failed", diagnostic: "execution_failed", version };
    }
    return isAgentToolVersionSupported(tool, version)
      ? { ...READY, version }
      : { status: "unsupported", diagnostic: "version_unsupported", version };
  }

  private async sandbox(
    control: AgentToolRunContext,
  ): Promise<AgentToolHealth> {
    const isAvailable = await probeBubblewrap(async (file, args) => {
      const result = await this.runner.run({
        file,
        arguments: args,
        provider: "codex_cli",
        home: await this.files.home(),
        environment: { TMPDIR: control.temporaryDirectory },
        signal: control.signal,
        stdin: "ignore",
        timeoutMs: 10_000,
      });
      if (result.exitCode !== 0 || result.errorCode)
        throw new Error("Sandbox probe failed");
    });
    return isAvailable
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
    control: CheckContext,
  ): Promise<AgentToolHealth> {
    const runner =
      tool.id === "codex_acp"
        ? (control.cli ?? (await this.resolve("codex")))
        : null;
    const claude =
      tool.id === "claude_acp"
        ? (control.cli ?? (await this.resolve("claude")))
        : null;
    const reported = await new AgentToolProtocolProbe(this.runner).check({
      tool,
      file: location.file,
      home: await this.files.home(),
      signal: control.signal,
      environment: {
        TMPDIR: control.temporaryDirectory,
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
    if (version === null || !isAgentToolVersionSupported(tool, version))
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
    control: AgentToolRunContext,
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
      file: "/usr/bin/bwrap",
      toolFile: process.execPath,
      arguments: [
        "--die-with-parent",
        "--unshare-pid",
        "--bind",
        "/",
        "/",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--",
        process.execPath,
        "-e",
        BROWSER_PROBE_SCRIPT,
      ],
      provider: "codex_cli",
      home: await this.files.home(),
      environment: {
        TMPDIR: control.temporaryDirectory,
        PAGES_RUN_INSTANCE: instanceId,
        PAGES_PLAYWRIGHT_ENTRY: mcp.file,
        PAGES_BROWSER: tool.id,
        PLAYWRIGHT_BROWSERS_PATH: path.join(location.release, "browsers"),
      },
      signal: control.signal,
      stdin: "ignore",
      timeoutMs: 20_000,
    });
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
  if (tool.id === "antigravity_acp") return "antigravity";
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
