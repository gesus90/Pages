import { createHash } from "node:crypto";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { cliEnvironment, cliInventory } from "@/scripts/runner/cli.mjs";

import {
  bindBoundary,
  calls,
  claudeCatalog,
  claudeModels,
  codexCatalog,
  home,
  killed,
  loggedInHost,
  restoreEnvironment,
  stdinListeners,
  stubExec,
} from "./runner-cli-harness";

import type { CliInventoryEntry } from "@/scripts/runner/cli.d.mts";

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

function revisionOf(entry: Omit<CliInventoryEntry, "catalogRevision">): string {
  return createHash("sha256").update(JSON.stringify(entry)).digest("hex");
}

it("keeps only host credential locations and neutral locale settings", () => {
  process.env.PAGES_DATABASE_URL = "must-not-leak";
  expect(cliEnvironment()).toEqual({
    HOME: home,
    PATH: "/synthetic/bin",
    CODEX_HOME: `${home}/.codex`,
    CLAUDE_CONFIG_DIR: `${home}/.claude`,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NO_COLOR: "1",
    DISABLE_AUTOUPDATER: "1",
  });
});

it("falls back to the process PATH, then to the system default", () => {
  delete process.env.PAGES_RUNNER_CLI_PATH;
  process.env.PATH = "/process/bin";
  expect(cliEnvironment().PATH).toBe("/process/bin");
  delete process.env.PATH;
  expect(cliEnvironment().PATH).toBe("/usr/bin:/bin");
});

it("uses the operating system home without an override and refuses invalid homes", () => {
  delete process.env.PAGES_RUNNER_CLI_HOME;
  expect(cliEnvironment().HOME.startsWith("/")).toBe(true);
  process.env.PAGES_RUNNER_CLI_HOME = "relative/home";
  expect(() => cliEnvironment()).toThrow("Invalid remote CLI home");
  process.env.PAGES_RUNNER_CLI_HOME = "/bad\0home";
  expect(() => cliEnvironment()).toThrow("Invalid remote CLI home");
});

it("lists the authenticated tools with validated, de-duplicated models and a catalog revision", async () => {
  loggedInHost();
  const tools = await cliInventory({ jobId: "job-1" });

  const codexEntry = {
    tool: "codex",
    version: "1.2.3-beta.1",
    authentication: "authenticated",
    models: [
      { id: "gpt-x", name: "Duplicate", reasoningEfforts: [] },
      { id: "plain", name: "plain", reasoningEfforts: [] },
    ],
  };
  const claudeEntry = {
    tool: "claude",
    version: "1.2.3-beta.1",
    authentication: "authenticated",
    models: [
      {
        id: "claude-sonnet-x",
        name: "Sonnet X",
        reasoningEfforts: ["low", "max"],
      },
      { id: "haiku", name: "haiku", reasoningEfforts: [] },
    ],
  };
  expect(tools).toEqual([
    { ...codexEntry, catalogRevision: revisionOf(codexEntry) },
    { ...claudeEntry, catalogRevision: revisionOf(claudeEntry) },
  ]);
});

it("queries only status, the picker and the version, each with the job and the CLI environment", async () => {
  loggedInHost();
  const controller = new AbortController();
  await cliInventory({ jobId: "job-7", signal: controller.signal });

  expect(calls.map((call) => `${call.tool} ${call.args[0]}`)).toEqual([
    "codex --version",
    "codex login",
    "codex debug",
    "claude --version",
    "claude auth",
    "claude --print",
  ]);
  expect(calls[1]?.args).toEqual(["login", "status"]);
  expect(calls[2]?.args).toEqual(["debug", "models"]);
  expect(calls[4]?.args).toEqual(["auth", "status", "--json"]);
  for (const call of calls) {
    expect(call.options.env).toMatchObject({
      ...cliEnvironment(),
      PAGES_REMOTE_JOB: "job-7",
    });
    expect(call.options.signal).toBe(controller.signal);
    expect(call.options.timeout).toBe(15000);
    expect(call.options.maxBuffer).toBe(1048576);
  }
});

it("sends the initialize request only to the Claude picker", async () => {
  loggedInHost();
  await cliInventory();
  expect(calls[2]?.input).toBeUndefined();
  expect(JSON.parse(calls[5]?.input ?? "")).toEqual({
    type: "control_request",
    request_id: "pages-model-catalog",
    request: {
      subtype: "initialize",
      hooks: {},
      agents: {},
      sdkMcpServers: [],
    },
  });
  expect(calls[5]?.args).toEqual([
    "--print",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--tools",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--safe-mode",
  ]);
});

it("omits the job variable without a job and kills a child whose stdin fails", async () => {
  loggedInHost();
  await cliInventory();
  expect(calls[0]?.options.env).not.toHaveProperty("PAGES_REMOTE_JOB");
  expect(calls[0]?.options.signal).toBeUndefined();
  stdinListeners.error?.();
  expect(killed).toHaveBeenCalledOnce();
});

it("skips tools that are not installed and reports a missing version as null", async () => {
  stubExec(({ tool, args }) => {
    if (tool === "codex") return { error: { code: "ENOENT" } };
    if (args[0] === "--version") return { stdout: "no number here" };
    return { error: { code: "1" } };
  });
  const tools = await cliInventory();
  expect(tools).toHaveLength(1);
  expect(tools[0]).toMatchObject({
    tool: "claude",
    version: null,
    authentication: "not_logged_in",
    models: [],
  });
  expect(
    calls.some((call) => call.tool === "codex" && call.args[0] !== "--version"),
  ).toBe(false);
});

it("does not request a catalog from a tool that is not logged in", async () => {
  loggedInHost({
    "codex login": { stdout: "Not logged in" },
    "claude auth": {
      stdout: JSON.stringify({ loggedIn: true, authMethod: "api_key" }),
    },
  });
  const tools = await cliInventory();
  expect(tools.map((tool) => tool.authentication)).toEqual([
    "not_logged_in",
    "not_logged_in",
  ]);
  expect(tools.every((tool) => tool.models.length === 0)).toBe(true);
  expect(
    calls.some(
      (call) => call.args[0] === "debug" || call.args[0] === "--print",
    ),
  ).toBe(false);
});

it("treats a status that exits with an error as not logged in", async () => {
  loggedInHost({
    "codex login": { error: { code: "1" }, stdout: "Logged in using ChatGPT" },
    "claude auth": { error: { code: "1" }, stdout: "{}" },
  });
  const tools = await cliInventory();
  expect(tools.map((tool) => tool.authentication)).toEqual([
    "not_logged_in",
    "not_logged_in",
  ]);
});

it("accepts the codex login line from stderr", async () => {
  loggedInHost({ "codex login": { stderr: "Logged in using ChatGPT" } });
  const [codex] = await cliInventory();
  expect(codex?.authentication).toBe("authenticated");
});

it("keeps the authentication unknown and the models empty when status output is unreadable", async () => {
  loggedInHost({ "claude auth": { stdout: "{not json" } });
  const claude = (await cliInventory()).find((tool) => tool.tool === "claude");
  expect(claude).toMatchObject({ authentication: "unknown", models: [] });
  expect(claude?.catalogRevision).toMatch(/^[0-9a-f]{64}$/);
});

it("returns no models when a picker fails or reports an error reply", async () => {
  loggedInHost({
    "codex debug": { error: { code: "1" }, stdout: codexCatalog },
    "claude --print": { stdout: claudeCatalog(claudeModels, "error") },
  });
  const tools = await cliInventory();
  expect(tools.map((tool) => tool.models)).toEqual([[], []]);
});

it("returns no models for a malformed catalog but keeps the login", async () => {
  loggedInHost({
    "codex debug": { stdout: JSON.stringify({ models: "nope" }) },
    "claude --print": { stdout: claudeCatalog("nope") },
  });
  const tools = await cliInventory();
  expect(tools.map((tool) => tool.models)).toEqual([[], []]);
  expect(tools.map((tool) => tool.authentication)).toEqual([
    "authenticated",
    "authenticated",
  ]);
});

it("ignores Claude control replies for other requests", async () => {
  loggedInHost({
    "claude --print": {
      stdout: claudeCatalog(claudeModels, "success", "someone-else"),
    },
  });
  expect((await cliInventory())[1]?.models).toEqual([]);
});

it("keeps the login but lists no models when the picker output is unparsable", async () => {
  loggedInHost({ "claude --print": { stdout: "garbage" } });
  expect((await cliInventory())[1]).toMatchObject({
    authentication: "authenticated",
    models: [],
  });
});

it("caps the catalog at 1000 models", async () => {
  const models = Array.from({ length: 1005 }, (_, index) => ({
    slug: `model-${index}`,
    visibility: "list",
  }));
  loggedInHost({ "codex debug": { stdout: JSON.stringify({ models }) } });
  const [codex] = await cliInventory();
  expect(codex?.models).toHaveLength(1000);
  expect(codex?.models[999]?.id).toBe("model-999");
});

it("appends the OpenCode and Antigravity inventories when they exist", async () => {
  stubExec(() => ({ error: { code: "ENOENT" } }));
  const openCode = { tool: "opencode", models: [] };
  const antigravity = { tool: "antigravity", models: [] };
  boundary.openCodeInventory.mockResolvedValue(openCode);
  boundary.antigravityInventory.mockResolvedValue(antigravity);
  const controller = new AbortController();

  const tools = await cliInventory({ signal: controller.signal });

  expect(tools).toEqual([openCode, antigravity]);
  expect(boundary.openCodeInventory).toHaveBeenCalledWith(cliEnvironment(), {
    signal: controller.signal,
  });
  expect(boundary.antigravityInventory).toHaveBeenCalledWith(cliEnvironment(), {
    signal: controller.signal,
  });
});

it("stops before any query when the signal is already aborted", async () => {
  loggedInHost();
  const controller = new AbortController();
  controller.abort(new Error("stopped"));
  await expect(cliInventory({ signal: controller.signal })).rejects.toThrow(
    "stopped",
  );
  expect(calls).toHaveLength(0);
});

it("stops after the OpenCode probe when the signal aborts meanwhile", async () => {
  const later = new AbortController();
  boundary.openCodeInventory.mockImplementation(() => {
    later.abort(new Error("late stop"));
    return Promise.resolve(null);
  });
  stubExec(() => ({ error: { code: "ENOENT" } }));
  await expect(cliInventory({ signal: later.signal })).rejects.toThrow(
    "late stop",
  );
  expect(boundary.antigravityInventory).toHaveBeenCalledOnce();
});
