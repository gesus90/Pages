import { readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { containsWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";

import { installRuntimeArchive } from "./AgentToolArchive";
import { AgentToolReadinessError } from "./AgentToolReadinessError";
import { isArchiveRelease } from "./AgentToolRegistry";
import { AgentToolRunFiles } from "./AgentToolRunFiles";
import { installAntigravityRelease } from "./AntigravityRelease";

import type { CliLocator } from "@/backend/agents/cli/CliLocator";
import type { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import type { AgentToolDefinition } from "./AgentToolRegistry";
import type {
  AgentToolInstallation,
  AgentToolLocation,
  AgentToolRelease,
  AgentToolStorage,
  AgentToolRunContext,
} from "./AgentToolContracts";

interface InstallContext extends AgentToolRunContext {
  readonly target: AgentToolRelease | null;
}

interface LockEntry {
  readonly version: unknown;
  readonly integrity: unknown;
}

function lockEntry(lock: unknown, key: string): LockEntry | null {
  if (typeof lock !== "object" || lock === null || !("packages" in lock))
    return null;
  const packages: unknown = lock.packages;
  if (typeof packages !== "object" || packages === null) return null;
  const entry: unknown = Object.entries(packages).find(
    ([name]) => name === key,
  )?.[1];
  if (typeof entry !== "object" || entry === null) return null;
  return {
    version: "version" in entry ? entry.version : null,
    integrity: "integrity" in entry ? entry.integrity : null,
  };
}

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
    id: "playwright_mcp" | "codex",
  ) => Promise<AgentToolLocation | null>;

  public constructor(input: {
    readonly files: AgentToolStorage;
    readonly locator: Pick<CliLocator, "locate">;
    readonly runner: Pick<CliProcessRunner, "run">;
    readonly resolve: (
      id: "playwright_mcp" | "codex",
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
    target: AgentToolRelease | null,
    signal: AbortSignal,
  ): Promise<void> {
    const runs = new AgentToolRunFiles(this.files);
    await runs.install(() =>
      runs.temporary((temporaryDirectory) =>
        this.installRelease(tool, candidate, {
          signal,
          temporaryDirectory,
          target,
        }),
      ),
    );
  }

  private async installRelease(
    tool: AgentToolDefinition,
    candidate: AgentToolLocation,
    control: InstallContext,
  ): Promise<void> {
    control.signal.throwIfAborted();
    if (!candidate.release) throw new Error("Missing managed release");
    if (process.getuid?.() === 0)
      throw new AgentToolReadinessError(tool.id, "failed", "root_not_allowed");
    if (isArchiveRelease(tool)) {
      await this.officialArchive(tool, candidate, control);
      return;
    }
    if (tool.kind === "browser") {
      await this.browser(tool, candidate, control);
      return;
    }
    await this.npmPackage(tool, candidate.release, control);
  }

  // The archive of a binary distribution is never installed without the source's digest.
  private async officialArchive(
    tool: AgentToolDefinition,
    candidate: AgentToolLocation,
    control: InstallContext,
  ): Promise<void> {
    const { signal, temporaryDirectory, target } = control;
    if (!target?.archiveUrl || !target.integrity)
      throw new Error("Unresolved official archive");
    const archive = {
      candidate,
      archiveUrl: target.archiveUrl,
      digest: target.integrity,
      files: this.files,
      locator: this.locator,
      runner: this.runner,
      temporaryDirectory,
    };
    if (tool.release?.kind === "github") {
      await installAntigravityRelease(
        { ...archive, binary: tool.binary, member: tool.release.member },
        signal,
      );
      return;
    }
    await installRuntimeArchive({ ...archive, tool: tool.id }, signal);
  }

  private async npmPackage(
    tool: AgentToolDefinition,
    release: string,
    control: InstallContext,
  ): Promise<void> {
    const { signal, temporaryDirectory, target } = control;
    const version = target?.version ?? tool.version;
    if (!tool.packageName || !version)
      throw new Error("Host provisioning required");
    const npm = await this.locator.locate("npm");
    if (!npm.path) throw new Error("npm is unavailable");
    await writeFile(
      path.join(release, "package.json"),
      JSON.stringify({
        private: true,
        dependencies: { [tool.packageName]: version },
        overrides: await this.overrides(tool, target),
      }),
      { mode: 0o600, flag: "wx" },
    );
    for (const name of [".npm-user.rc", ".npm-global.rc"])
      await writeFile(path.join(release, name), "", {
        mode: 0o600,
        flag: "wx",
      });
    const result = await this.runner.run({
      file: npm.path,
      arguments: [
        "install",
        "--prefix",
        release,
        "--registry=https://registry.npmjs.org",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
      ],
      provider: "codex_cli",
      home: await this.files.home(),
      environment: this.environment(release, temporaryDirectory),
      signal,
      stdin: "ignore",
      timeoutMs: 180_000,
    });
    if (result.exitCode !== 0 || result.errorCode)
      throw new Error("Managed npm installation failed");
    await this.requireIntegrity(tool, release, target);
    await this.postinstall(tool, release, control);
  }

  // The bundled CLI of codex-acp is pinned to the CLI generation it runs with.
  private async overrides(
    tool: AgentToolDefinition,
    target: AgentToolRelease | null,
  ): Promise<Readonly<Record<string, string>>> {
    if (tool.id !== "codex_acp") return {};
    const version =
      target?.cliVersion ?? (await this.resolve("codex"))?.version;
    return version ? { "@openai/codex": version } : {};
  }

  // npm records the integrity of what it unpacked; it has to equal the registry's proof.
  private async requireIntegrity(
    tool: AgentToolDefinition,
    release: string,
    target: AgentToolRelease | null,
  ): Promise<void> {
    if (!target?.integrity || !tool.packageName) return;
    const lock: unknown = JSON.parse(
      await readFile(path.join(release, "package-lock.json"), "utf8"),
    );
    const entry = lockEntry(lock, `node_modules/${tool.packageName}`);
    if (
      entry?.version !== target.version ||
      entry.integrity !== target.integrity
    )
      throw new AgentToolReadinessError(tool.id, "failed", "integrity_failed");
  }

  private environment(
    release: string,
    temporaryDirectory: string,
  ): Record<string, string> {
    return {
      TMPDIR: temporaryDirectory,
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
    control: AgentToolRunContext,
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
      environment: this.environment(release, control.temporaryDirectory),
      signal: control.signal,
      stdin: "ignore",
      timeoutMs: 60_000,
    });
    if (result.exitCode !== 0 || result.errorCode)
      throw new Error("Approved package setup failed");
  }

  private async browser(
    tool: AgentToolDefinition,
    candidate: AgentToolLocation,
    control: AgentToolRunContext,
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
        TMPDIR: control.temporaryDirectory,
        PLAYWRIGHT_BROWSERS_PATH: path.join(candidate.release, "browsers"),
      },
      signal: control.signal,
      stdin: "ignore",
      timeoutMs: 180_000,
    });
    if (result.exitCode !== 0 || result.errorCode)
      throw new Error("Browser download failed");
    await this.linkBrowser(tool, candidate, { mcp, ...control });
  }
  private async linkBrowser(
    tool: AgentToolDefinition,
    candidate: AgentToolLocation,
    control: AgentToolRunContext & { readonly mcp: AgentToolLocation },
  ): Promise<void> {
    if (!candidate.release) throw new Error("Missing browser generation");
    const result = await this.runner.run({
      file: process.execPath,
      arguments: ["-e", BROWSER_EXECUTABLE_SCRIPT],
      provider: "codex_cli",
      home: await this.files.home(),
      environment: {
        TMPDIR: control.temporaryDirectory,
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
