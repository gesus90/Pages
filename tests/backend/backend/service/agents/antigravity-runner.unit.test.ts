import { beforeEach, expect, it, vi } from "vitest";
import { Readable } from "node:stream";

import {
  antigravityInventory,
  antigravityContextProof,
  executeAntigravity,
} from "@/scripts/runner/antigravity.mjs";
import { CliTerminalResult } from "@/scripts/runner/result.mjs";
import { runnerTerminalSchema } from "@/definition/RunnerTerminal";

import { fakeChild } from "../../agents/cli/fake-child-process";

import type { SpawnOptions } from "node:child_process";
import type { RunnerExecution } from "@/definition/RunnerExecution";

import type * as ChildProcessModule from "node:child_process";
import type { CliSpawn } from "@/backend/agents/cli/CliContracts";

const boundary = vi.hoisted(() => ({
  spawn: vi.fn<CliSpawn>(),
  loggedIn: true,
  incompatible: false,
  refuse: false,
  stallPrompt: false,
  stallInitialize: false,
  workspaceHook: false,
  symlinkContext: false,
  expiredLogin: false,
  boundContext: false,
  untrustedContext: false,
  mappedAncestor: false,
  changedAncestor: false,
  calls: [] as { method: string; params: Record<string, unknown> }[],
}));

function syntheticOwner(file: string): number {
  if (file !== "/synthetic") return process.getuid?.() ?? 0;
  return boundary.mappedAncestor ? 65534 : 0;
}

function syntheticInode(file: string): number {
  return file === "/synthetic" && boundary.changedAncestor ? 2 : 1;
}
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof ChildProcessModule>()),
  spawn: boundary.spawn,
}));
vi.mock("node:fs/promises", () => ({
  lstat: vi.fn(async (file: string) => {
    if (
      boundary.boundContext &&
      [
        "/synthetic",
        "/synthetic/bound",
        "/synthetic/bound/home",
        "/synthetic/bound/gemini",
        "/synthetic/bound/config",
        "/synthetic/bound/work",
      ].includes(file)
    )
      return {
        isDirectory: (): boolean => true,
        isSymbolicLink: (): boolean =>
          boundary.untrustedContext && file === "/synthetic/bound",
        uid: syntheticOwner(file),
        mode: file === "/synthetic" ? 0o755 : 0o700,
        dev: 1,
        ino: syntheticInode(file),
      };
    if (file.endsWith("/antigravity-acp"))
      return {
        isDirectory: (): boolean => true,
        isSymbolicLink: (): boolean => boundary.symlinkContext,
      };
    if (
      file.endsWith("/workspace/.agents/hooks.json") &&
      boundary.workspaceHook
    )
      return { isFile: (): boolean => true };
    if (
      file.endsWith("settings.json") ||
      (file.endsWith("acp_token.json") && boundary.loggedIn)
    )
      return { isFile: () => true, isSymbolicLink: () => false, size: 64 };
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  }),
  readFile: vi.fn(async () => '{"auth":{"type":"oauth-personal"}}'),
}));

let activeChild: ReturnType<typeof fakeChild> | null = null;

const OPTIONS = [
  {
    id: "model",
    type: "select",
    currentValue: "flash-family",
    options: [{ value: "flash-family", name: "Flash" }],
  },
  {
    id: "thinking_level",
    type: "select",
    currentValue: "low",
    options: [{ value: "low", name: "Low" }],
  },
  {
    id: "mode",
    type: "select",
    currentValue: "default",
    options: [
      { value: "default", name: "Default" },
      { value: "yolo", name: "YOLO" },
    ],
  },
];

function isPaused(method: string): boolean {
  return (
    (method === "initialize" && boundary.stallInitialize) ||
    (method === "session/prompt" && boundary.stallPrompt)
  );
}

function processBoundary(): ReturnType<typeof fakeChild> {
  const fake = fakeChild();
  activeChild = fake;
  fake.stdin.on("finish", () => fake.child.emit("close", 0, null));
  fake.kill.mockImplementation((signal) => {
    Object.defineProperty(fake.child, "signalCode", {
      value: signal,
      configurable: true,
    });
    fake.child.emit("close", null, signal);
    return true;
  });
  fake.stdin.on("data", (chunk: Buffer) => {
    const request: unknown = JSON.parse(chunk.toString());
    if (
      typeof request !== "object" ||
      request === null ||
      !("method" in request) ||
      typeof request.method !== "string" ||
      !("id" in request)
    )
      return;
    const params =
      "params" in request &&
      typeof request.params === "object" &&
      request.params !== null
        ? Object.fromEntries(Object.entries(request.params))
        : {};
    boundary.calls.push({ method: request.method, params });
    if (request.method === "session/new" && boundary.expiredLogin) {
      fake.stderr.write("Open the following link to authenticate\n");
      return;
    }
    if (isPaused(request.method)) return;
    if (request.method === "session/prompt") {
      for (const update of [
        {
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "Synthetic Pages read",
          status: "completed",
          kind: "read",
        },
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Synthetic ACP reply" },
        },
      ])
        fake.stdout.write(
          `${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "synthetic-session", update } })}\n`,
        );
    }
    const result = response(request.method, params);
    fake.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`,
    );
  });
  return fake;
}

function response(method: string, params: Record<string, unknown>): unknown {
  if (method === "initialize")
    return {
      protocolVersion: 1,
      agentInfo: {
        name: "antigravity-acp",
        version: boundary.incompatible ? "1.4.3" : "1.4.4",
      },
      authMethods: [{ id: "oauth-personal", name: "Google" }],
    };
  if (method === "session/new")
    return { sessionId: "synthetic-session", configOptions: OPTIONS };
  if (method === "session/set_config_option")
    return {
      configOptions: OPTIONS.map((option) =>
        option.id === params.configId
          ? {
              ...option,
              currentValue: boundary.refuse ? "refused" : params.value,
            }
          : option,
      ),
    };
  return {
    stopReason: "end_turn",
    usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
  };
}

beforeEach(() => {
  boundary.loggedIn = true;
  boundary.incompatible = false;
  boundary.refuse = false;
  boundary.stallPrompt = false;
  boundary.stallInitialize = false;
  boundary.workspaceHook = false;
  boundary.symlinkContext = false;
  boundary.expiredLogin = false;
  boundary.boundContext = false;
  boundary.untrustedContext = false;
  boundary.mappedAncestor = false;
  boundary.changedAncestor = false;
  activeChild = null;
  boundary.calls = [];
  boundary.spawn.mockReset();
  boundary.spawn.mockImplementation(() => processBoundary().child);
  vi.stubEnv("PAGES_RUNNER_ANTIGRAVITY_HOME", undefined);
  vi.stubEnv("PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT", undefined);
  vi.stubEnv("PAGES_RUNNER_CONTEXT_PROOF", undefined);
  vi.stubEnv("PAGES_RUNNER_JOB_NAMESPACE", undefined);
});

it("accepts an unmapped root ancestor only with the same host-validated identity", async () => {
  boundary.boundContext = true;
  vi.stubEnv("PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT", "/synthetic/bound");
  const proof = await antigravityContextProof();
  boundary.mappedAncestor = true;
  vi.stubEnv("PAGES_RUNNER_JOB_NAMESPACE", "1");
  vi.stubEnv("PAGES_RUNNER_CONTEXT_PROOF", proof);
  await expect(
    antigravityInventory({ HOME: "/synthetic/host" }),
  ).resolves.toMatchObject({ authentication: "authenticated" });
  boundary.changedAncestor = true;
  await expect(
    antigravityInventory({ HOME: "/synthetic/host" }),
  ).rejects.toThrow("Unmanaged Antigravity context");
});

it("binds an operator-owned context in place after validating its ancestors", async () => {
  boundary.boundContext = true;
  vi.stubEnv("PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT", "/synthetic/bound");
  const inventory = await antigravityInventory({
    HOME: "/synthetic/host",
    PATH: "/synthetic/bin",
  });
  expect(inventory.authentication).toBe("authenticated");
  expect(boundary.spawn.mock.calls[0]?.[2]?.env).toMatchObject({
    HOME: "/synthetic/bound/home",
    GEMINI_HOME: "/synthetic/bound/gemini",
    XDG_CONFIG_HOME: "/synthetic/bound/config",
    XDG_CACHE_HOME: "/synthetic/bound/work",
  });
});

it("refuses a symlinked bound context before starting the adapter", async () => {
  boundary.boundContext = true;
  boundary.untrustedContext = true;
  vi.stubEnv("PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT", "/synthetic/bound");
  await expect(
    antigravityInventory({ HOME: "/synthetic/host" }),
  ).rejects.toThrow("Unmanaged Antigravity context");
  expect(boundary.spawn).not.toHaveBeenCalled();
});

it("does not start the OpenCode entry point when Antigravity imports it", async () => {
  const previousArguments = [...process.argv];
  const previousInput = Object.getOwnPropertyDescriptor(process, "stdin");
  const previousExit = process.exitCode;
  const output = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
  try {
    process.argv[1] = "/synthetic/antigravity.mjs";
    process.argv[2] = "--acp";
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: Readable.from([]),
    });
    vi.resetModules();
    await import("@/scripts/runner/opencode.mjs");
    expect(output).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(previousExit);
  } finally {
    output.mockRestore();
    process.argv = previousArguments;
    process.exitCode = previousExit;
    if (previousInput) Object.defineProperty(process, "stdin", previousInput);
  }
});

it("probes auth and exact selectors at the simulated execution host with no prompt or credential transfer", async () => {
  await expect(
    antigravityInventory({ HOME: "/synthetic/host", PATH: "/synthetic/bin" }),
  ).resolves.toMatchObject({
    tool: "antigravity",
    version: "1.4.4",
    authentication: "authenticated",
    acp: { status: "verified" },
    models: [{ id: "flash-family", reasoningEfforts: ["low"] }],
  });
  expect(boundary.calls.some((call) => call.method === "session/prompt")).toBe(
    false,
  );
  const options: SpawnOptions | undefined = boundary.spawn.mock.calls[0]?.[2];
  expect(options?.env).toMatchObject({
    GEMINI_HOME: "/synthetic/host/.pages-antigravity",
    BROWSER: "/bin/true",
  });
});

it("does not reinterpret missing host login or incompatible adapter as an available model", async () => {
  boundary.loggedIn = false;
  await expect(
    antigravityInventory({ HOME: "/synthetic/host" }),
  ).resolves.toMatchObject({ authentication: "not_logged_in", models: [] });
  boundary.incompatible = true;
  await expect(
    antigravityInventory({ HOME: "/synthetic/host" }),
  ).resolves.toMatchObject({ acp: { status: "incompatible" }, models: [] });
});

it("reports an expired host login without waiting for a browser or publishing its challenge", async () => {
  boundary.expiredLogin = true;
  await expect(
    antigravityInventory({ HOME: "/synthetic/host" }),
  ).resolves.toMatchObject({ authentication: "not_logged_in", models: [] });
  expect(boundary.calls.some((call) => call.method === "session/prompt")).toBe(
    false,
  );
  expect(activeChild?.kill).toHaveBeenCalledWith("SIGKILL");
});

it("preserves the session, tool updates, exact model/effort and result through simulated remote transport", async () => {
  const output = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
  const result = await executeAntigravity(
    {
      workspace: "/synthetic/workspace",
      model: "flash-family",
      reasoningEffort: "low",
      access: "read_only",
      mcpServers: [],
    },
    "synthetic prompt",
    { HOME: "/synthetic/host" },
  );
  expect(result).toMatchObject({
    type: "pages.result",
    sessionId: "synthetic-session",
    stopReason: "end_turn",
    answer: "Synthetic ACP reply",
    usage: { inputTokens: 12, outputTokens: 3 },
  });
  expect(
    boundary.calls
      .filter((call) => call.method === "session/set_config_option")
      .map((call) => call.params.value),
  ).toEqual(["flash-family", "low", "default"]);
  expect(
    output.mock.calls.some(
      ([line]) =>
        typeof line === "string" && line.includes("Synthetic Pages read"),
    ),
  ).toBe(true);
});

it("refuses silently changed selectors before the remote prompt", async () => {
  boundary.refuse = true;
  await expect(
    executeAntigravity(
      {
        workspace: "/synthetic/workspace",
        model: "flash-family",
        reasoningEffort: "low",
        access: "read_only",
        mcpServers: [],
      },
      "synthetic prompt",
      { HOME: "/synthetic/host" },
    ),
  ).rejects.toMatchObject({ pagesCode: "plan_model_unavailable" });
  expect(boundary.calls.some((call) => call.method === "session/prompt")).toBe(
    false,
  );
});

it.each(["workspaceHook", "symlinkContext"] as const)(
  "refuses %s before starting a remote adapter that could widen access",
  async (source) => {
    boundary[source] = true;
    await expect(
      executeAntigravity(
        {
          workspace: "/synthetic/workspace",
          model: "flash-family",
          reasoningEffort: "low",
          access: "read_only",
          mcpServers: [],
        },
        "synthetic prompt",
        { HOME: "/synthetic/host" },
      ),
    ).rejects.toMatchObject({
      pagesCode: "antigravity_configuration_unmanaged",
    });
    expect(boundary.spawn).not.toHaveBeenCalled();
    await expect(
      antigravityInventory({ HOME: "/synthetic/workspace" }),
    ).resolves.toMatchObject({ authentication: "unknown", models: [] });
    expect(boundary.calls.some((call) => call.method === "session/new")).toBe(
      false,
    );
  },
);

it("produces the existing versioned terminal receipt with Antigravity provenance and token counts", () => {
  const command: RunnerExecution = {
    version: 1,
    revision: 1,
    workspace: "/synthetic/workspace",
    timeoutSeconds: 60,
    outputBytes: 65536,
    input: "{}",
    resultPayloadVersion: 1,
    program: {
      kind: "cli",
      route: {
        tool: "antigravity",
        connectionId: "10000000-0000-4000-8000-000000000001",
        workspaceId: "10000000-0000-4000-8000-000000000002",
        catalogRevision: "synthetic",
      },
      model: "flash-family",
      reasoningEffort: "low",
      access: "read_only",
      prompt: "synthetic",
    },
  };
  const terminal = new CliTerminalResult(command, (text) => text);
  terminal.receive({
    type: "pages.result",
    sessionId: "synthetic-session",
    stopReason: "end_turn",
    answer: "synthetic result",
    usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
  });
  expect(terminal.result()).toMatchObject({
    output: "synthetic result",
    reason: null,
  });
  expect(runnerTerminalSchema.parse(terminal.result().terminal)).toMatchObject({
    provider: "antigravity",
    status: "completed",
    sessionId: "synthetic-session",
    usage: { inputTokens: 12, outputTokens: 3 },
  });
});

it("fails the native remote turn after cancellation of its process boundary and cannot produce a successful receipt", async () => {
  boundary.stallPrompt = true;
  const pending = executeAntigravity(
    {
      workspace: "/synthetic/workspace",
      model: "flash-family",
      reasoningEffort: "low",
      access: "read_only",
      mcpServers: [],
    },
    "synthetic",
    { HOME: "/synthetic/host" },
  );
  const rejected = expect(pending).rejects.toThrow("ACP ended");
  await vi.waitFor(() =>
    expect(
      boundary.calls.some((call) => call.method === "session/prompt"),
    ).toBe(true),
  );
  activeChild?.kill("SIGTERM");
  await rejected;
  expect(activeChild?.kill).toHaveBeenCalledWith("SIGTERM");
});

it("cancels an inventory probe through its signal and closes the bounded transport", async () => {
  boundary.stallInitialize = true;
  const controller = new AbortController();
  const pending = antigravityInventory(
    { HOME: "/synthetic/host" },
    { signal: controller.signal },
  );
  await vi.waitFor(() => expect(boundary.spawn).toHaveBeenCalledOnce());
  controller.abort();
  await expect(pending).resolves.toMatchObject({
    authentication: "unknown",
    models: [],
    acp: { status: "incompatible" },
  });
  expect(activeChild?.kill).toHaveBeenCalledWith("SIGKILL");
});
