import { createHash } from "node:crypto";

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import {
  agent,
  agentChild,
  fakeChild,
  load,
  methods,
  resetAgent,
  stubExec,
} from "./runner-opencode-harness";

import type { ExecResult, Json } from "./runner-opencode-harness";

import type * as ChildProcessModule from "node:child_process";
import type * as FsPromisesModule from "node:fs/promises";

const boundary = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  mkdtemp: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof ChildProcessModule>()),
  spawn: boundary.spawn,
  execFile: boundary.execFile,
}));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof FsPromisesModule>()),
  mkdtemp: boundary.mkdtemp,
  rm: boundary.rm,
}));

beforeEach(() => {
  resetAgent();
  boundary.spawn.mockReset();
  boundary.execFile.mockReset();
  boundary.mkdtemp.mockReset().mockResolvedValue("/synthetic/check");
  boundary.rm.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const environment = { PATH: "/bin" };

async function check(version: string | null): Promise<Json> {
  const { checkOpenCodeAcp } = await load();
  return checkOpenCodeAcp(environment, version);
}

it("verifies the exact version over a real ACP exchange without a model call", async () => {
  const fake = agentChild();
  boundary.spawn.mockReturnValue(fake.child);
  expect(await check("1.18.34")).toEqual({
    status: "verified",
    reason: "exact_version",
  });
  const [command, args, options] = boundary.spawn.mock.calls[0] as [
    string,
    string[],
    { cwd: string; env: Record<string, string>; stdio: unknown },
  ];
  expect(command).toBe("opencode");
  expect(args).toEqual(["acp", "--port", "0", "--hostname", "127.0.0.1"]);
  expect(options.cwd).toBe("/synthetic/check");
  expect(options.env.PATH).toBe("/bin");
  expect(options.env.OPENCODE_SERVER_PASSWORD).toMatch(/^[\w-]{43}$/);
  expect(options.stdio).toEqual(["pipe", "pipe", "ignore"]);
  expect(methods(fake)).toEqual(["initialize", "session/new"]);
  expect(fake.sent[0]?.params).toEqual({
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    },
  });
  expect(fake.sent[1]?.params).toEqual({
    cwd: "/synthetic/check",
    mcpServers: [],
  });
  expect(fake.child.kill).toHaveBeenCalledWith("SIGKILL");
  expect(boundary.rm).toHaveBeenCalledWith("/synthetic/check", {
    recursive: true,
    force: true,
  });
});

it("calls a matching newer contract compatible", async () => {
  agent.version = "1.19.0";
  boundary.spawn.mockReturnValue(agentChild().child);
  expect(await check("1.19.0")).toEqual({
    status: "compatible",
    reason: "contract_matches",
  });
});

it.each([
  ["another agent", () => (agent.name = "Other"), "agent_mismatch"],
  ["another protocol", () => (agent.protocolVersion = 2), "protocol_mismatch"],
  [
    "a missing model selector",
    () => (agent.modelType = "text"),
    "selectors_missing",
  ],
  [
    "a missing mode selector",
    () => (agent.modeType = "text"),
    "selectors_missing",
  ],
  ["a session without an id", () => (agent.sessionId = 5), "selectors_missing"],
  [
    "another reported version",
    () => (agent.version = "9.9.9"),
    "agent_mismatch",
  ],
])("is incompatible with %s", async (label, mutate, reason) => {
  mutate();
  boundary.spawn.mockReturnValue(agentChild().child);
  expect(await check("1.18.34")).toEqual({ status: "incompatible", reason });
});

it("reports a failed probe and still cleans up", async () => {
  const fake = agentChild();
  agent.newError = true;
  boundary.spawn.mockReturnValue(fake.child);
  expect(await check("1.18.34")).toEqual({
    status: "incompatible",
    reason: "probe_failed",
  });
  expect(fake.child.kill).toHaveBeenCalledWith("SIGKILL");
  expect(boundary.rm).toHaveBeenCalledTimes(1);
});

it("kills a probe that stays silent after thirty seconds", async () => {
  vi.useFakeTimers();
  try {
    const fake = fakeChild();
    boundary.spawn.mockReturnValue(fake.child);
    const { checkOpenCodeAcp } = await load();
    const result = checkOpenCodeAcp(environment, "1.18.34");
    await vi.advanceTimersByTimeAsync(30000);
    expect(fake.child.kill).toHaveBeenCalledWith("SIGKILL");
    fake.child.emit("close");
    expect(await result).toEqual({
      status: "incompatible",
      reason: "probe_failed",
    });
  } finally {
    vi.useRealTimers();
  }
});

it("kills the child when its input pipe fails", async () => {
  const fake = fakeChild();
  boundary.spawn.mockReturnValue(fake.child);
  const { checkOpenCodeAcp } = await load();
  const result = checkOpenCodeAcp(environment, "1.18.34");
  await vi.waitFor(() => expect(boundary.spawn).toHaveBeenCalled());
  fake.child.stdin?.emit("error", new Error("EPIPE"));
  expect(fake.child.kill).toHaveBeenCalledWith("SIGKILL");
  fake.child.emit("close");
  expect((await result).reason).toBe("probe_failed");
});

describe("openCodeInventory", () => {
  const listing = `openai/gpt-5\n${JSON.stringify(
    { name: "GPT 5", variants: { high: {} } },
    null,
    2,
  )}\nlocal/m\n${JSON.stringify({ name: "Local" }, null, 2)}\n`;

  function stubCli(
    version: ExecResult,
    models: ExecResult = { stdout: listing },
  ): void {
    stubExec(boundary.execFile, (args) =>
      args[0] === "--version" ? version : models,
    );
  }

  it("is null when OpenCode is not installed", async () => {
    stubCli({ error: Object.assign(new Error("gone"), { code: "ENOENT" }) });
    const { openCodeInventory } = await load();
    expect(await openCodeInventory({ PATH: "/bin" })).toBeNull();
    expect(boundary.spawn).not.toHaveBeenCalled();
    expect(boundary.execFile).toHaveBeenCalledTimes(1);
  });

  it("lists models and providers, checks ACP once per version and hashes the catalog", async () => {
    stubCli({ stdout: "opencode 1.18.34\n" });
    boundary.spawn.mockImplementation(() => agentChild().child);
    const { openCodeInventory } = await load();
    const signal = new AbortController().signal;
    const inventory = await openCodeInventory({ PATH: "/bin" }, { signal });
    expect(inventory).toMatchObject({
      tool: "opencode",
      version: "1.18.34",
      authentication: "authenticated",
      providers: ["openai", "local"],
      acp: { status: "verified", reason: "exact_version" },
    });
    expect(inventory?.models).toHaveLength(2);
    const { catalogRevision, ...rest } = inventory ?? {};
    expect(catalogRevision).toBe(
      createHash("sha256").update(JSON.stringify(rest)).digest("hex"),
    );
    const calls = boundary.execFile.mock.calls as unknown as [
      string,
      string[],
      { env: Record<string, string>; signal?: AbortSignal; timeout: number },
    ][];
    expect(calls.map(([, args]) => args)).toEqual([
      ["--version"],
      ["models", "--verbose"],
    ]);
    expect(calls[0]?.[2]).toMatchObject({ timeout: 15000, signal });
    expect(calls[1]?.[2].timeout).toBe(60000);
    expect(calls[0]?.[2].env.OPENCODE_DISABLE_AUTOUPDATE).toBe("1");

    const again = await openCodeInventory({ PATH: "/bin" });
    expect(boundary.spawn).toHaveBeenCalledTimes(1);
    expect(again?.catalogRevision).toBe(catalogRevision);

    stubCli({ stdout: "opencode 1.18.34\n" }, { stdout: "" });
    const empty = await openCodeInventory({ PATH: "/bin" });
    expect(empty?.catalogRevision).not.toBe(catalogRevision);
    expect(boundary.spawn).toHaveBeenCalledTimes(1);

    agent.version = "2.0.0";
    stubCli({ stdout: "v2.0.0-beta.1" });
    const upgraded = await openCodeInventory({ PATH: "/bin" });
    expect(boundary.spawn).toHaveBeenCalledTimes(2);
    expect(upgraded).toMatchObject({
      version: "2.0.0-beta.1",
      acp: { status: "incompatible", reason: "agent_mismatch" },
    });
  });

  it("stays unauthenticated without models when the listing fails or the version is unreadable", async () => {
    stubCli(
      { stdout: "no number here" },
      { error: new Error("exit 1"), stdout: listing },
    );
    boundary.spawn.mockImplementation(() => agentChild().child);
    const { openCodeInventory } = await load();
    const inventory = await openCodeInventory({});
    expect(inventory).toMatchObject({
      version: null,
      authentication: "unknown",
      models: [],
      providers: [],
      acp: { status: "incompatible", reason: "agent_mismatch" },
    });
    expect(boundary.spawn).toHaveBeenCalledTimes(1);
  });
});
