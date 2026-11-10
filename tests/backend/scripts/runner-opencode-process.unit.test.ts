import { Readable } from "node:stream";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  MODULE_FILE,
  agent,
  agentChild,
  lastFake,
  methods,
  resetAgent,
  textUpdate,
} from "./runner-opencode-harness";

import type { AgentSettings, Fake, Json } from "./runner-opencode-harness";

interface Configuration {
  readonly default_agent: string;
  readonly permission: Json;
  readonly agent: Record<string, { readonly variant: string }>;
}

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

interface Run {
  readonly lines: Json[];
  readonly exitCode: number | string | undefined;
  readonly fake: Fake;
  readonly environment: Record<string, string>;
}

const stdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin");
let savedArgv: string[];
let savedExit: typeof process.exitCode;

beforeEach(() => {
  savedArgv = process.argv;
  savedExit = process.exitCode;
});

afterEach(() => {
  process.argv = savedArgv;
  process.exitCode = savedExit;
  if (stdinDescriptor) Object.defineProperty(process, "stdin", stdinDescriptor);
  delete process.env.PAGES_OPENCODE_JOB;
});

async function execute(
  job: Json | string | undefined,
  chunks: (string | Buffer)[] = ["Do the thing"],
  drain = false,
): Promise<Run> {
  const fake = agentChild();
  boundary.spawn.mockReturnValue(fake.child);
  const lines: Json[] = [];
  const write = vi.spyOn(process.stdout, "write").mockImplementation(((
    text: string,
  ) => {
    lines.push(JSON.parse(text) as Json);
    if (drain) setTimeout(() => process.stdout.emit("drain"), 0);
    return !drain;
  }) as never);
  Object.defineProperty(process, "stdin", {
    value: Readable.from(chunks.map((chunk) => Buffer.from(chunk))),
    configurable: true,
  });
  process.argv = [process.argv[0] ?? "node", MODULE_FILE, "--acp"];
  if (job !== undefined)
    process.env.PAGES_OPENCODE_JOB =
      typeof job === "string" ? job : JSON.stringify(job);
  process.exitCode = undefined;
  vi.resetModules();
  await import("@/scripts/runner/opencode.mjs");
  const exitCode = process.exitCode;
  write.mockRestore();
  const environment = (
    boundary.spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { env: Record<string, string> },
    ]
  )?.[2].env;
  return { lines, exitCode, fake, environment: environment ?? {} };
}

const job = {
  access: "yolo",
  model: "openai/gpt-5",
  reasoningEffort: "high",
  workspace: "/synthetic/work",
  mcpServers: [{ name: "pages" }],
  resumeSessionId: null,
};

it("runs a yolo job end to end and prints events and the final answer", async () => {
  const run = await execute(job);
  expect(run.exitCode).toBe(0);
  expect(methods(run.fake)).toEqual([
    "initialize",
    "session/new",
    "session/set_config_option",
    "session/set_config_option",
    "session/set_config_option",
    "session/prompt",
  ]);
  expect(
    run.fake.sent
      .filter((message) => message.method === "session/set_config_option")
      .map((message) => message.params),
  ).toEqual([
    { sessionId: "native-session", configId: "mode", value: "pages-yolo" },
    { sessionId: "native-session", configId: "model", value: "openai/gpt-5" },
    { sessionId: "native-session", configId: "effort", value: "high" },
  ]);
  expect(run.fake.sent[1]?.params).toEqual({
    cwd: "/synthetic/work",
    mcpServers: [{ name: "pages" }],
  });
  expect(run.fake.sent.at(-1)?.params).toEqual({
    sessionId: "native-session",
    prompt: [{ type: "text", text: "Do the thing" }],
  });
  expect(run.lines[0]).toEqual({
    type: "pages.session",
    sessionId: "native-session",
    canResume: true,
  });
  expect(run.lines.at(-1)).toEqual({
    type: "pages.result",
    sessionId: "native-session",
    stopReason: "end_turn",
    usage: { inputTokens: 3 },
    answer: "Hello world",
  });
  expect(
    run.lines.filter((event) => event.type === "pages.update"),
  ).toHaveLength(3);
  expect(run.fake.child.kill).toHaveBeenCalledWith("SIGKILL");

  const configuration = JSON.parse(
    run.environment.OPENCODE_CONFIG_CONTENT ?? "",
  ) as Configuration;
  expect(run.environment.OPENCODE_DISABLE_AUTOUPDATE).toBe("1");
  expect(run.environment.OPENCODE_SERVER_PASSWORD).toBeTruthy();
  expect(configuration).toMatchObject({
    share: "disabled",
    autoupdate: false,
    model: "openai/gpt-5",
    small_model: "openai/gpt-5",
    enabled_providers: ["openai"],
    default_agent: "pages-yolo",
    permission: {
      "*": "allow",
      read: { "*": "allow", "*.env": "deny", "*.env.*": "deny" },
    },
    agent: {
      "pages-yolo": {
        mode: "primary",
        model: "openai/gpt-5",
        variant: "high",
      },
      build: { disable: true },
      plan: { disable: true },
      title: { disable: true },
      summary: { disable: true },
      general: { model: "openai/gpt-5", variant: "high" },
      compaction: { model: "openai/gpt-5", variant: "high" },
    },
    compaction: { auto: true },
  });
});

it("denies by default in read-only mode, skips the effort selector and resumes a recorded session", async () => {
  const run = await execute({
    ...job,
    access: "read-only",
    reasoningEffort: null,
    resumeSessionId: "recorded",
  });
  expect(run.exitCode).toBe(0);
  expect(methods(run.fake)).toEqual([
    "initialize",
    "session/resume",
    "session/set_config_option",
    "session/set_config_option",
    "session/prompt",
  ]);
  expect(run.fake.sent[1]?.params).toEqual({
    sessionId: "recorded",
    cwd: "/synthetic/work",
    mcpServers: [{ name: "pages" }],
  });
  expect(run.lines[0]).toMatchObject({
    type: "pages.session",
    sessionId: "recorded",
  });
  const configuration = JSON.parse(
    run.environment.OPENCODE_CONFIG_CONTENT ?? "",
  ) as Configuration;
  expect(configuration.default_agent).toBe("pages-read-only");
  expect(configuration.permission).toMatchObject({
    "*": "deny",
    list: "allow",
    glob: "allow",
    grep: "allow",
    webfetch: "allow",
    websearch: "allow",
    "pages_*": "allow",
  });
  expect(configuration.agent["pages-read-only"].variant).toBe("default");
});

it("approves tool permissions in yolo mode and rejects them otherwise", async () => {
  const options = [
    { optionId: "no", kind: "reject_once" },
    { optionId: "yes", kind: "allow_once" },
  ];
  const ask: AgentSettings["prompt"] = (reply, request) => {
    reply({
      id: 700,
      method: "session/request_permission",
      params: { options },
    });
    reply(textUpdate("ok"));
    reply({ id: request.id, result: { stopReason: "end_turn" } });
  };
  agent.prompt = ask;
  const yolo = await execute(job);
  expect(yolo.fake.sent.find((message) => message.id === 700)).toEqual({
    jsonrpc: "2.0",
    id: 700,
    result: { outcome: { outcome: "selected", optionId: "yes" } },
  });
  expect(yolo.lines.at(-1)).toMatchObject({ answer: "ok", usage: null });

  const readOnly = await execute({ ...job, access: "read-only" });
  expect(readOnly.fake.sent.find((message) => message.id === 700)).toEqual({
    jsonrpc: "2.0",
    id: 700,
    result: { outcome: { outcome: "selected", optionId: "no" } },
  });

  agent.prompt = (reply, request) => {
    reply({
      id: 701,
      method: "session/request_permission",
      params: { options: [{ optionId: "later", kind: "allow_always" }] },
    });
    reply(textUpdate("ok"));
    reply({ id: request.id, result: { stopReason: "end_turn" } });
  };
  const unmatched = await execute(job);
  expect(unmatched.fake.sent.find((message) => message.id === 701)).toEqual({
    jsonrpc: "2.0",
    id: 701,
    result: { outcome: { outcome: "cancelled" } },
  });
});

it("waits for drain when stdout applies backpressure", async () => {
  const run = await execute(job, ["Do the thing"], true);
  expect(run.exitCode).toBe(0);
  expect(run.lines.at(-1)).toMatchObject({ answer: "Hello world" });
});

it("reports an unsupported contract when the agent is not OpenCode", async () => {
  agent.name = "Other";
  const run = await execute(job);
  expect(run.exitCode).toBe(1);
  expect(run.lines).toEqual([
    {
      type: "pages.result",
      stopReason: "error",
      error: "opencode_acp_unsupported",
    },
  ]);
});

it.each([
  [
    "a mode that is not offered",
    () => (agent.modes = ["other"]),
    "opencode_acp_unsupported",
  ],
  [
    "a model that is not offered",
    () => (agent.models = ["x/y"]),
    "plan_model_unavailable",
  ],
  [
    "an effort that is not offered",
    () => (agent.efforts = ["low"]),
    "plan_reasoning_unsupported",
  ],
  [
    "a selection the agent ignores",
    () => (agent.ignoreSet = true),
    "opencode_acp_unsupported",
  ],
])("refuses %s with its stable code", async (label, mutate, code) => {
  mutate();
  const run = await execute(job);
  expect(run.exitCode).toBe(1);
  expect(run.lines.at(-1)).toEqual({
    type: "pages.result",
    stopReason: "error",
    error: code,
  });
  expect(methods(run.fake)).not.toContain("session/prompt");
  expect(run.fake.child.kill).toHaveBeenCalledWith("SIGKILL");
});

it("fails a resume the agent refuses or cannot do instead of opening a new session", async () => {
  agent.resumeFails = true;
  const refused = await execute({ ...job, resumeSessionId: "gone" });
  expect(refused.lines.at(-1)).toMatchObject({
    error: "acp_session_resume_failed",
  });
  expect(methods(refused.fake)).not.toContain("session/new");

  agent.resumeFails = false;
  agent.resume = false;
  const unsupported = await execute({ ...job, resumeSessionId: "old" });
  expect(unsupported.lines.at(-1)).toMatchObject({
    error: "acp_session_resume_failed",
  });
  expect(methods(unsupported.fake)).toEqual(["initialize"]);
});

it("reports a turn that stopped early or produced no text as a failed session with its receipt", async () => {
  agent.prompt = (reply, request) => {
    reply(textUpdate("partial"));
    reply({ id: request.id, result: { stopReason: "max_tokens" } });
  };
  const stopped = await execute(job);
  expect(stopped.exitCode).toBe(1);
  expect(stopped.lines.at(-1)).toEqual({
    type: "pages.result",
    sessionId: "native-session",
    stopReason: "max_tokens",
    usage: null,
    error: "opencode_acp_session_failed",
  });

  agent.prompt = (reply, request) => {
    reply(textUpdate("   "));
    reply({ id: request.id, result: { stopReason: "end_turn" } });
  };
  const blank = await execute(job);
  expect(blank.exitCode).toBe(1);
  expect(blank.lines.at(-1)).toMatchObject({
    stopReason: "end_turn",
    error: "opencode_acp_session_failed",
  });

  agent.prompt = (reply, request) => reply({ id: request.id });
  const empty = await execute(job);
  expect(empty.lines.at(-1)).toMatchObject({
    error: "opencode_acp_session_failed",
  });
  expect(empty.lines.at(-1)?.stopReason).toBeUndefined();
});

it("classifies a native prompt failure without leaking the provider text", async () => {
  agent.prompt = (reply, request) =>
    reply({
      id: request.id,
      error: {
        code: 429,
        message: "secret detail",
        data: { status: "rate limit" },
      },
    });
  const run = await execute(job);
  expect(run.exitCode).toBe(1);
  expect(run.lines.at(-1)).toEqual({
    type: "pages.result",
    stopReason: "error",
    error: "provider_rate_limited",
  });
  expect(JSON.stringify(run.lines)).not.toContain("secret detail");
});

it("classifies a process failure by the text of its error", async () => {
  agent.prompt = () =>
    lastFake()?.child.emit("error", new Error("fetch failed"));
  const unreachable = await execute(job);
  expect(unreachable.exitCode).toBe(1);
  expect(unreachable.lines.at(-1)).toEqual({
    type: "pages.result",
    stopReason: "error",
    error: "provider_unreachable",
  });
  agent.prompt = () => lastFake()?.child.emit("close");
  const ended = await execute(job);
  expect(ended.lines.at(-1)).toMatchObject({
    error: "opencode_acp_session_failed",
  });
});

it("does not catch a job variable that is not JSON", async () => {
  await expect(execute("not json at all")).rejects.toBeInstanceOf(SyntaxError);
  expect(boundary.spawn).not.toHaveBeenCalled();
});

it("fails a job without a model and a prompt above one MiB", async () => {
  const missing = await execute(undefined);
  expect(missing.exitCode).toBe(1);
  expect(missing.lines.at(-1)).toMatchObject({
    error: "opencode_acp_session_failed",
  });

  const large = await execute(job, [Buffer.alloc(1048577, 0x61)]);
  expect(large.exitCode).toBe(1);
  expect(large.lines.at(-1)).toMatchObject({
    error: "opencode_acp_session_failed",
  });
  expect(methods(large.fake)).toEqual([]);
});

it("reads a multi-byte prompt split across chunks", async () => {
  const bytes = Buffer.from("Grüße 🙂");
  const run = await execute(job, [bytes.subarray(0, 4), bytes.subarray(4)]);
  expect(run.fake.sent.at(-1)?.params).toMatchObject({
    prompt: [{ type: "text", text: "Grüße 🙂" }],
  });
});

it("removes the job from the environment of the process once read", async () => {
  await execute(job);
  expect(process.env.PAGES_OPENCODE_JOB).toBeUndefined();
});
