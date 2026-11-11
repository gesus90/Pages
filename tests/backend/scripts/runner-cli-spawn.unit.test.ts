import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { spawnCli } from "@/scripts/runner/cli.mjs";

import {
  bindBoundary,
  command,
  expectedEnvironment,
  inventoryOf,
  launchFor,
  loggedInHost,
  restoreEnvironment,
  routeOf,
  spawned,
  stubExec,
} from "./runner-cli-harness";

import type { CliCommand } from "@/scripts/runner/cli.d.mts";
import type * as ChildProcessModule from "node:child_process";

const boundary = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
  openCodeInventory: vi.fn(),
  openCodeResult: vi.fn(),
  openCodeCommand: vi.fn(),
  antigravityInventory: vi.fn(),
  antigravityCommand: vi.fn(),
}));

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof ChildProcessModule>()),
  execFile: boundary.execFile,
  spawn: boundary.spawn,
}));
vi.mock("@/scripts/runner/opencode.mjs", () => ({
  openCodeInventory: boundary.openCodeInventory,
  openCodeResult: boundary.openCodeResult,
  openCodeCommand: boundary.openCodeCommand,
  remoteBanner: (workspace: string): string => `[banner ${workspace}]`,
}));
vi.mock("@/scripts/runner/antigravity.mjs", () => ({
  antigravityInventory: boundary.antigravityInventory,
  antigravityCommand: boundary.antigravityCommand,
}));

beforeEach(() => {
  bindBoundary(boundary);
});

afterEach(() => {
  restoreEnvironment();
});

const folder = "/synthetic/jobs/a/b/folder";
const signal = (): AbortSignal => new AbortController().signal;

it("starts an ephemeral read-only codex exec after rechecking the catalog", async () => {
  loggedInHost();
  const { result, child } = await launchFor("codex");
  expect(result).toBe(child);
  const { tool, args, options } = spawned();
  expect(tool).toBe("codex");
  expect(args).toEqual([
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-user-config",
    "--color",
    "never",
    "--json",
    "-C",
    "/synthetic/work",
    "-m",
    "gpt-x",
    "-c",
    "mcp_servers={}",
    "-c",
    "features.apps=false",
    "-c",
    "features.plugins=false",
    "-c",
    "features.multi_agent=false",
    "--sandbox",
    "read-only",
    "-c",
    "features.shell_tool=false",
    "-c",
    "features.unified_exec=false",
    "-c",
    "features.apply_patch_freeform=false",
    "-c",
    "features.code_mode=false",
    "-",
  ]);
  expect(options).toMatchObject({
    cwd: "/synthetic/work",
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  expect(options.env).toEqual(
    expectedEnvironment({ PAGES_REMOTE_JOB: "job-9" }),
  );
});

it("bypasses the codex sandbox for yolo and passes the reasoning effort", async () => {
  const models = [
    {
      slug: "gpt-x",
      visibility: "list",
      supported_reasoning_levels: [{ effort: "high" }],
    },
  ];
  loggedInHost({ "codex debug": { stdout: JSON.stringify({ models }) } });
  await launchFor("codex", {
    program: { access: "yolo", reasoningEffort: "high" },
  });
  const { args } = spawned();
  expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
  expect(args).not.toContain("--sandbox");
  expect(args.slice(-3)).toEqual(["-c", 'model_reasoning_effort="high"', "-"]);
});

it("keeps a codex continuation session without resume when no thread was recorded", async () => {
  loggedInHost();
  await launchFor("codex", { continuation: {} });
  const { args } = spawned();
  expect(args).not.toContain("--ephemeral");
  expect(args).not.toContain("resume");
});

it("resumes the recorded codex thread with folder and colour ahead of the subcommand", async () => {
  loggedInHost();
  await launchFor("codex", { continuation: { resumeSessionId: "thread-5" } });
  const { args } = spawned();
  expect(args.slice(0, 7)).toEqual([
    "exec",
    "--color",
    "never",
    "-C",
    "/synthetic/work",
    "resume",
    "--skip-git-repo-check",
  ]);
  expect(args).not.toContain("--ephemeral");
  expect(args.filter((arg) => arg === "-C")).toHaveLength(1);
  expect(args.filter((arg) => arg === "--color")).toHaveLength(1);
  expect(args.slice(-2)).toEqual(["thread-5", "-"]);
});

it("configures the required step-bound Pages bridge for codex without a credential", async () => {
  loggedInHost();
  await launchFor("codex", { pagesAccess: 1 });
  const { args } = spawned();
  const bridge = args.find((arg) => arg.startsWith("mcp_servers.pages="));
  const script = fileURLToPath(
    new URL("../../../scripts/runner/pages.mjs", import.meta.url),
  );
  const bridgeArgs = [
    script,
    "--mcp",
    join(folder, "..", "..", "pages.sock"),
    "job-9",
  ];
  expect(bridge).toBe(
    `mcp_servers.pages={command=${JSON.stringify(process.execPath)},args=${JSON.stringify(bridgeArgs)},required=true,startup_timeout_sec=30}`,
  );
  expect(args[args.indexOf(bridge ?? "") - 1]).toBe("-c");
  expect(args.at(-1)).toBe("-");
});

it("starts a safe-mode read-only claude print run with the exact model", async () => {
  loggedInHost();
  await launchFor("claude");
  const { tool, args, options } = spawned();
  expect(tool).toBe("claude");
  expect(args).toEqual([
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--safe-mode",
    "--model",
    "claude-sonnet-x",
    "--tools",
    "Read,Glob,Grep,WebSearch,WebFetch",
    "--allowedTools",
    "WebSearch,WebFetch",
    "--permission-mode",
    "dontAsk",
  ]);
  expect(options.env).toEqual(
    expectedEnvironment({
      CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK: "1",
      CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP: "1",
      PAGES_REMOTE_JOB: "job-9",
    }),
  );
});

it("isolates claude settings, resumes the session and bridges Pages for yolo runs", async () => {
  loggedInHost();
  await launchFor("claude", {
    pagesAccess: 1,
    continuation: { resumeSessionId: "session-3" },
    program: { access: "yolo", reasoningEffort: "max" },
  });
  const { args, options } = spawned();
  expect(args).not.toContain("--no-session-persistence");
  expect(args).not.toContain("--safe-mode");
  const resume = args.indexOf("--resume");
  expect(args.slice(resume, resume + 2)).toEqual(["--resume", "session-3"]);
  const settings = args.indexOf("--settings");
  expect(args.slice(settings - 3, settings + 2)).toEqual([
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--settings",
    JSON.stringify({ disableAllHooks: true, autoMemoryEnabled: false }),
  ]);
  expect(args).toEqual(
    expect.arrayContaining([
      "--permission-mode",
      "bypassPermissions",
      "--dangerously-skip-permissions",
      "--effort",
      "max",
      "--allowedTools",
      "mcp__pages__*",
    ]),
  );
  expect(args).not.toContain("dontAsk");
  expect(options.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
});

it("passes the Pages bridge to claude as an MCP config", async () => {
  loggedInHost();
  await launchFor("claude", { pagesAccess: 1 });
  const { args } = spawned();
  const config = JSON.parse(args[args.indexOf("--mcp-config") + 1] ?? "") as {
    mcpServers: { pages: { command: string; args: string[] } };
  };
  expect(config.mcpServers.pages.command).toBe(process.execPath);
  expect(config.mcpServers.pages.args.slice(1)).toEqual([
    "--mcp",
    "/synthetic/jobs/a/pages.sock",
    "job-9",
  ]);
});

it("keeps a claude continuation session without resuming when no thread was recorded", async () => {
  loggedInHost();
  await launchFor("claude", { continuation: {} });
  const { args } = spawned();
  expect(args).not.toContain("--no-session-persistence");
  expect(args).not.toContain("--resume");
});

async function goodCodexCommand(): Promise<CliCommand> {
  const inventory = await inventoryOf("codex");
  return command({
    program: { route: routeOf("codex", inventory?.catalogRevision) },
  });
}

it("refuses a model, revision, effort or access that the host does not confirm", async () => {
  loggedInHost();
  const good = await goodCodexCommand();
  const refusals: Partial<CliCommand["program"]>[] = [
    { model: "unknown" },
    { route: routeOf("codex", "stale") },
    { reasoningEffort: "high" },
    { access: "write" },
  ];
  for (const program of refusals)
    await expect(
      spawnCli(
        { ...good, program: { ...good.program, ...program } },
        "j",
        signal(),
        folder,
      ),
    ).rejects.toThrow("CLI selection unavailable");
  expect(boundary.spawn).not.toHaveBeenCalled();
});

it("refuses a tool that is logged out or missing", async () => {
  loggedInHost();
  const good = await goodCodexCommand();
  loggedInHost({ "codex login": { stdout: "Not logged in" } });
  await expect(spawnCli(good, "j", signal(), folder)).rejects.toThrow(
    "CLI selection unavailable",
  );
  stubExec(() => ({ error: { code: "ENOENT" } }));
  await expect(spawnCli(good, "j", signal(), folder)).rejects.toThrow(
    "CLI selection unavailable",
  );
  expect(boundary.spawn).not.toHaveBeenCalled();
});

it("throws the abort reason after a valid check instead of starting the process", async () => {
  loggedInHost();
  const good = await goodCodexCommand();
  const controller = new AbortController();
  boundary.openCodeInventory.mockImplementation(() => {
    controller.abort(new Error("cancelled"));
    return Promise.resolve(null);
  });
  await expect(spawnCli(good, "j", controller.signal, folder)).rejects.toThrow(
    "cancelled",
  );
  expect(boundary.spawn).not.toHaveBeenCalled();
});
