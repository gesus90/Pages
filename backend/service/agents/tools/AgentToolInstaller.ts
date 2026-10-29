import { realpath, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { containsWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";

import { AgentToolReadinessError } from "./AgentToolReadinessError";
import { installAntigravityRelease } from "./AntigravityRelease";

import type { CliLocator } from "@/backend/agents/cli/CliLocator";
import type { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import type { AgentToolDefinition } from "./AgentToolRegistry";
import type {
  AgentToolInstallation,
  AgentToolLocation,
  AgentToolStorage,
} from "./AgentToolContracts";

/** Resolves the browser installed by the package, without a runtime download. */
export const BROWSER_EXECUTABLE_SCRIPT = `
const { createRequire } = require('node:module');
const load = createRequire(require('node:fs').realpathSync(process.env.PAGES_PLAYWRIGHT_ENTRY));
process.stdout.write(load('playwright')[process.env.PAGES_BROWSER].executablePath());
`;

/** Installs fixed registry packages into unpublished instance-local generations. */
export class AgentToolInstaller implements AgentToolInstallation {
  private readonly files: AgentToolStorage;
  private readonly locator: Pick<CliLocator, "locate">;
  private readonly runner: Pick<CliProcessRunner, "run">;
  private readonly resolve: (
    id: "playwright_mcp",
  ) => Promise<AgentToolLocation | null>;

  public constructor(input: {
    readonly files: AgentToolStorage;
    readonly locator: Pick<CliLocator, "locate">;
    readonly runner: Pick<CliProcessRunner, "run">;
    readonly resolve: (
      id: "playwright_mcp",
    ) => Promise<AgentToolLocation | null>;
  }) {
    this.files = input.files;
    this.locator = input.locator;
    this.runner = input.runner;
    this.resolve = input.resolve;
  }

  /** No globals, shell strings, host homes, credential inputs or privileged commands. */
  public async install(
    tool: AgentToolDefinition,
    candidate: AgentToolLocation,
    signal: AbortSignal,
  ): Promise<void> {
    if (!candidate.release) throw new Error("Missing managed release");
    if (process.getuid?.() === 0)
      throw new AgentToolReadinessError(tool.id, "failed", "root_not_allowed");
    if (tool.id === "antigravity_acp") {
      await installAntigravityRelease(
        {
          candidate,
          files: this.files,
          locator: this.locator,
          runner: this.runner,
        },
        signal,
      );
      return;
    }
    if (tool.kind === "browser") {
      await this.browser(tool, candidate, signal);
      return;
    }
    if (!tool.packageName || !tool.version)
      throw new Error("Host provisioning required");
    const npm = await this.locator.locate("npm");
    if (!npm.path) throw new Error("npm is unavailable");
    await writeFile(
      path.join(candidate.release, "package.json"),
      JSON.stringify({
        private: true,
        dependencies: { [tool.packageName]: tool.version },
        overrides:
          tool.id === "codex_acp" ? { "@openai/codex": "0.160.1" } : {},
      }),
      { mode: 0o600, flag: "wx" },
    );
    for (const name of [".npm-user.rc", ".npm-global.rc"])
      await writeFile(path.join(candidate.release, name), "", {
        mode: 0o600,
        flag: "wx",
      });
    const result = await this.runner.run({
      file: npm.path,
      arguments: [
        "install",
        "--prefix",
        candidate.release,
        "--registry=https://registry.npmjs.org",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
      ],
      provider: "codex_cli",
      home: await this.files.home(),
      environment: this.environment(candidate.release),
      signal,
      stdin: "ignore",
      timeoutMs: 180_000,
    });
    if (result.exitCode !== 0 || result.errorCode)
      throw new Error("Managed npm installation failed");
    await this.postinstall(tool, candidate.release, signal);
  }

  private environment(release: string): Record<string, string> {
    return {
      TMPDIR: path.join(this.files.root, "probe"),
      npm_config_cache: path.join(this.files.root, "npm-cache"),
      npm_config_userconfig: path.join(release, ".npm-user.rc"),
      npm_config_globalconfig: path.join(release, ".npm-global.rc"),
      npm_config_update_notifier: "false",
      npm_config_prefix: release,
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
      DISABLE_AUTOUPDATER: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    };
  }

  private async postinstall(
    tool: AgentToolDefinition,
    release: string,
    signal: AbortSignal,
  ): Promise<void> {
    const scripts: Readonly<Record<string, string>> = {
      claude: "install.cjs",
      opencode: "postinstall.mjs",
    };
    const script = scripts[tool.id];
    if (!script || !tool.packageName) return;
    const result = await this.runner.run({
      file: process.execPath,
      arguments: [path.join(release, "node_modules", tool.packageName, script)],
      workingDirectory: release,
      provider: "codex_cli",
      home: await this.files.home(),
      environment: this.environment(release),
      signal,
      stdin: "ignore",
      timeoutMs: 60_000,
    });
    if (result.exitCode !== 0 || result.errorCode)
      throw new Error("Approved package setup failed");
  }

  private async browser(
    tool: AgentToolDefinition,
    candidate: AgentToolLocation,
    signal: AbortSignal,
  ): Promise<void> {
    const mcp = await this.resolve("playwright_mcp");
    if (!mcp || !candidate.release)
      throw new Error("Playwright MCP is unavailable");
    const load = createRequire(await realpath(mcp.file));
    const manifest = load.resolve("playwright/package.json");
    const result = await this.runner.run({
      file: process.execPath,
      arguments: [
        path.join(path.dirname(manifest), "cli.js"),
        "install",
        tool.binary,
      ],
      provider: "codex_cli",
      home: await this.files.home(),
      environment: {
        TMPDIR: path.join(this.files.root, "probe"),
        PLAYWRIGHT_BROWSERS_PATH: path.join(candidate.release, "browsers"),
      },
      signal,
      stdin: "ignore",
      timeoutMs: 180_000,
    });
    if (result.exitCode !== 0 || result.errorCode)
      throw new Error("Browser download failed");
    await this.linkBrowser(tool, candidate, { mcp, signal });
  }
  private async linkBrowser(
    tool: AgentToolDefinition,
    candidate: AgentToolLocation,
    control: { readonly mcp: AgentToolLocation; readonly signal: AbortSignal },
  ): Promise<void> {
    if (!candidate.release) throw new Error("Missing browser generation");
    const result = await this.runner.run({
      file: process.execPath,
      arguments: ["-e", BROWSER_EXECUTABLE_SCRIPT],
      provider: "codex_cli",
      home: await this.files.home(),
      environment: {
        PAGES_PLAYWRIGHT_ENTRY: control.mcp.file,
        PAGES_BROWSER: tool.id,
        PLAYWRIGHT_BROWSERS_PATH: path.join(candidate.release, "browsers"),
      },
      signal: control.signal,
      stdin: "ignore",
      timeoutMs: 10_000,
    });
    if (result.exitCode !== 0 || result.errorCode)
      throw new Error("Browser executable resolution failed");
    const executable = await realpath(result.stdout.trim());
    if (!containsWorkspacePath(candidate.release, executable))
      throw new Error("Browser executable outside managed generation");
    await symlink(
      path.relative(path.dirname(candidate.file), executable),
      candidate.file,
      "file",
    );
  }
}
