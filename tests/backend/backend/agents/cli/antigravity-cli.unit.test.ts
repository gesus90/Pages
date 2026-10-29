import { beforeEach, expect, it, vi } from "vitest";

import { AntigravityCli } from "@/backend/agents/cli/AntigravityCli";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { CliToolExecution } from "@/backend/agents/cli/CliToolExecution";
import { antigravityFailure } from "@/backend/agents/cli/AntigravityProtocol";
import { RequestError } from "@agentclientprotocol/sdk";

import { fakeChild } from "./fake-child-process";

import type { CliHome } from "@/backend/agents/cli/CliContracts";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";

const boundary = vi.hoisted(() => ({
  hasToken: true,
  cleanupConfirmed: true,
  close: vi.fn(
    async (child: { endInput(): void; readonly exited: Promise<unknown> }) => {
      child.endInput();
      await child.exited;
      return { isConfirmed: boundary.cleanupConfirmed };
    },
  ),
}));
vi.mock("@/backend/agents/acp/AntigravityConfiguration", () => ({
  requireManagedAntigravityConfiguration: vi.fn(async () => {}),
}));
vi.mock("node:fs/promises", () => ({
  lstat: vi.fn(async () => ({
    isFile: () => boundary.hasToken,
    isSymbolicLink: () => false,
  })),
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  readSpawnScope: vi.fn(async () => ({})),
}));
vi.mock("@/backend/agents/cli/CliSessionCloseout", () => ({
  closeCliSession: boundary.close,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logEvent: vi.fn(),
  logCaughtError: vi.fn(),
}));

const HOME: CliHome = {
  root: "/synthetic",
  home: "/synthetic/home",
  config: "/synthetic/config",
  work: "/synthetic/work",
};

interface RpcCall {
  readonly method: string;
  readonly params: Record<string, unknown>;
}
interface FakeOptions {
  readonly answer?: string;
  readonly expiredToken?: boolean;
  readonly refuse?: string;
  readonly remap?: string;
  readonly authError?: boolean;
  readonly version?: string;
  readonly pendingLogin?: boolean;
  readonly logout?: boolean;
}

function selectors(
  model = "flash-family",
  effort = "low",
): SessionConfigOption[] {
  return [
    {
      id: "model",
      name: "Model",
      type: "select",
      currentValue: model,
      options: [
        { value: "flash-family", name: "Flash" },
        { value: "other-family", name: "Other" },
      ],
    },
    {
      id: "thinking_level",
      name: "Thinking",
      type: "select",
      currentValue: effort,
      options: [
        { value: "low", name: "Low" },
        { value: "high", name: "High" },
      ],
    },
    {
      id: "mode",
      name: "Mode",
      type: "select",
      currentValue: "default",
      options: [{ value: "default", name: "Default" }],
    },
  ];
}

function start(options: FakeOptions = {}): {
  readonly adapter: AntigravityCli;
  readonly calls: RpcCall[];
  readonly signal: AbortSignal;
} {
  const calls: RpcCall[] = [];
  const children: ReturnType<typeof fakeChild>[] = [];
  const runner = new CliProcessRunner({
    spawn: () => {
      const fake = fakeChild();
      children.push(fake);
      fake.stdin.on("finish", () => {
        fake.child.emit("close", 0, null);
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
            ? request.params
            : {};
        const call: RpcCall = {
          method: request.method,
          params: Object.fromEntries(Object.entries(params)),
        };
        calls.push(call);
        if (request.method === "session/new" && options.expiredToken) {
          fake.stderr.write(
            "Open the following link to authenticate the ACP server: https://accounts.google.com/o/oauth2/auth?response_type=code&state=synthetic&redirect_uri=http%3A%2F%2F127.0.0.1%3A45678%2F\n",
          );
          return;
        }
        if (request.method === "authenticate") {
          fake.stderr.write(
            "Open the following link to authenticate the ACP server: https://accounts.google.com/o/oauth2/auth?response_type=code&state=synthetic&redirect_uri=http%3A%2F%2F127.0.0.1%3A45678%2F\n",
          );
          if (options.pendingLogin) return;
        }
        if (request.method === "session/prompt")
          fake.stdout.write(
            `${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "synthetic-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: options.answer ?? "OK" } } } })}\n`,
          );
        const result = response(call, options);
        fake.stdout.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: request.id, ...result })}\n`,
        );
      });
      return fake.child;
    },
    signalGroup: (processId, signal) => {
      for (const fake of children) fake.child.emit("close", null, signal);
    },
  });
  return {
    adapter: new AntigravityCli(
      new CliToolExecution(
        runner,
        "/synthetic/agy_acp_server.par",
        "antigravity",
      ),
    ),
    calls,
    signal: AbortSignal.timeout(3000),
  };
}

function response(
  call: RpcCall,
  options: FakeOptions,
): Record<string, unknown> {
  if (options.authError && call.method === "authenticate")
    return { error: { code: -32000, message: "Authentication required" } };
  if (call.method === "initialize")
    return {
      result: {
        protocolVersion: 1,
        agentInfo: {
          name: "antigravity-acp",
          version: options.version ?? "1.4.4",
        },
        authMethods: [{ id: "oauth-personal", name: "Google" }],
        agentCapabilities:
          options.logout === false ? {} : { auth: { logout: {} } },
      },
    };
  if (call.method === "session/new")
    return {
      result: { sessionId: "synthetic-session", configOptions: selectors() },
    };
  if (call.method === "session/set_config_option") {
    if (call.params.configId === options.refuse)
      return { error: { code: -32602, message: "Unavailable" } };
    const picked = selectors();
    const option = picked.find((entry) => entry.id === call.params.configId);
    if (
      option &&
      option.type === "select" &&
      typeof call.params.value === "string"
    )
      option.currentValue =
        call.params.configId === options.remap ? "high" : call.params.value;
    return { result: { configOptions: picked } };
  }
  return {
    result: call.method === "session/prompt" ? { stopReason: "end_turn" } : {},
  };
}

beforeEach(() => {
  boundary.hasToken = true;
  boundary.cleanupConfirmed = true;
  boundary.close.mockClear();
});

it("checks the adapter handshake and always closes the metadata process", async () => {
  const fake = start();
  await expect(fake.adapter.version(HOME, fake.signal)).resolves.toMatchObject({
    ok: true,
    detail: { cliVersion: "1.4.4" },
  });
  expect(fake.calls.map((call) => call.method)).toEqual(["initialize"]);
  expect(boundary.close).toHaveBeenCalledOnce();
});

it("does not infer ACP login from a terminal installation or missing context token", async () => {
  boundary.hasToken = false;
  const fake = start();
  await expect(
    fake.adapter.readStatus(HOME, fake.signal),
  ).resolves.toMatchObject({
    outcome: { ok: false, errorCode: "cli_not_logged_in" },
  });
  expect(fake.calls).toEqual([]);
});

it("proves auth with session/new in the actual context without a prompt", async () => {
  const fake = start();
  await expect(
    fake.adapter.readStatus(HOME, fake.signal),
  ).resolves.toMatchObject({
    outcome: { ok: true, detail: { authMethod: "oauth-personal" } },
  });
  expect(fake.calls.map((call) => call.method)).toEqual([
    "initialize",
    "session/new",
  ]);
  expect(fake.calls[1]?.params).toMatchObject({
    _meta: { antigravity: { enabledTools: [] } },
  });
});

it("lists model families and their own thinking selector without any paid prompt", async () => {
  const fake = start();
  const models = await fake.adapter.listModels(HOME, fake.signal);
  expect(models.map((model) => [model.id, model.reasoningEfforts])).toEqual([
    ["flash-family", ["low", "high"]],
    ["other-family", ["low", "high"]],
  ]);
  expect(fake.calls.some((call) => call.method === "session/prompt")).toBe(
    false,
  );
});

it("rejects an unconfirmed thinking level before any model prompt", async () => {
  const fake = start({ remap: "thinking_level" });
  await expect(
    fake.adapter.runTest(
      HOME,
      { model: "flash-family", reasoningEffort: "low" },
      fake.signal,
    ),
  ).resolves.toMatchObject({
    ok: false,
    errorCode: "plan_reasoning_unsupported",
  });
  expect(fake.calls.some((call) => call.method === "session/prompt")).toBe(
    false,
  );
});

it("never falls back from a missing model or incompatible adapter", async () => {
  const fake = start();
  await expect(
    fake.adapter.runTest(
      HOME,
      { model: "cli-alias-not-in-acp", reasoningEffort: "low" },
      fake.signal,
    ),
  ).resolves.toMatchObject({ ok: false, errorCode: "plan_model_unavailable" });
  const old = start({ version: "1.4.3" });
  await expect(old.adapter.version(HOME, old.signal)).resolves.toMatchObject({
    ok: false,
    errorCode: "antigravity_acp_unsupported",
  });
  expect(old.calls).toHaveLength(1);
});

it("passes only oauth-personal and keeps challenge data out of completion diagnostics", async () => {
  const fake = start();
  const challenge = vi.fn();
  const login = fake.adapter.startLogin(HOME, challenge);
  await expect(login.completed).resolves.toMatchObject({
    exitCode: 0,
    stdout: "",
    stderr: "",
    errorCode: null,
  });
  expect(
    fake.calls.find((call) => call.method === "authenticate")?.params,
  ).toEqual({ methodId: "oauth-personal" });
  expect(challenge).toHaveBeenCalledWith(
    expect.objectContaining({
      verificationUrl:
        "https://accounts.google.com/o/oauth2/auth?response_type=code&state=synthetic&redirect_uri=http%3A%2F%2F127.0.0.1%3A45678%2F",
    }),
  );
  expect(login.write("invented-code")).toBe(false);
});

it("reports login failure, preserves the real provider contract and requires advertised logout", async () => {
  const fake = start({ authError: true });
  await expect(
    fake.adapter.startLogin(HOME, vi.fn()).completed,
  ).resolves.toMatchObject({
    exitCode: 1,
    errorCode: "cli_not_logged_in",
    stdout: "",
    stderr: "",
  });
  const unavailable = start({ logout: false });
  await expect(
    unavailable.adapter.logout(HOME, unavailable.signal),
  ).resolves.toMatchObject({
    ok: false,
    errorCode: "antigravity_acp_unsupported",
  });
  const available = start();
  await expect(
    available.adapter.logout(HOME, available.signal),
  ).resolves.toMatchObject({ ok: true });
  expect(available.calls.at(-1)?.method).toBe("logout");
});

it("does not report successful setup when closeout is unconfirmed", async () => {
  boundary.cleanupConfirmed = false;
  const fake = start();
  await expect(fake.adapter.version(HOME, fake.signal)).resolves.toMatchObject({
    ok: false,
    errorCode: "credential_cleanup_failed",
  });
});

it("classifies auth, quota, timeout and process failures without upstream text", () => {
  expect(
    antigravityFailure(
      new RequestError(-32000, "private"),
      new AbortController().signal,
    ),
  ).toBe("cli_not_logged_in");
  expect(
    antigravityFailure(
      new Error("quota exhausted"),
      new AbortController().signal,
    ),
  ).toBe("provider_quota_exhausted");
  expect(
    antigravityFailure(new Error("EOF"), new AbortController().signal),
  ).toBe("antigravity_acp_session_failed");
  const controller = new AbortController();
  controller.abort(new DOMException("deadline", "TimeoutError"));
  expect(antigravityFailure(new Error("private"), controller.signal)).toBe(
    "check_timeout",
  );
});

it("runs the explicit selected-model check only after all selectors are confirmed", async () => {
  const fake = start();
  await expect(
    fake.adapter.runTest(
      HOME,
      { model: "flash-family", reasoningEffort: "low" },
      fake.signal,
    ),
  ).resolves.toMatchObject({
    ok: true,
    detail: { model: "flash-family", reasoningEffort: "low" },
  });
  expect(fake.calls.at(-1)?.method).toBe("session/prompt");
  expect(
    fake.calls
      .filter((call) => call.method === "session/set_config_option")
      .map((call) => call.params.configId),
  ).toEqual(["model", "thinking_level", "mode"]);
});

it.each(["login_cancelled", "login_expired"] as const)(
  "cancels the adapter-owned callback and retains %s without secrets",
  async (code) => {
    const fake = start({ pendingLogin: true });
    const login = fake.adapter.startLogin(HOME, vi.fn());
    await vi.waitFor(() =>
      expect(fake.calls.some((call) => call.method === "authenticate")).toBe(
        true,
      ),
    );
    login.cancel(code);
    await expect(login.completed).resolves.toMatchObject({
      errorCode: code,
      stdout: "",
      stderr: "",
    });
    expect(boundary.close).toHaveBeenCalledOnce();
    const retry = start();
    await expect(
      retry.adapter.startLogin(HOME, vi.fn()).completed,
    ).resolves.toMatchObject({ exitCode: 0, errorCode: null });
  },
);

it("reports an expired ACP token without starting a new interactive sign-in", async () => {
  const fake = start({ expiredToken: true });
  await expect(
    fake.adapter.readStatus(HOME, fake.signal),
  ).resolves.toMatchObject({
    outcome: { ok: false, errorCode: "cli_not_logged_in" },
  });
  expect(boundary.close).toHaveBeenCalledOnce();
});

it("does not accept a truncated model check as exact OK", async () => {
  const fake = start({ answer: " ".repeat(70000) + "OK" });
  await expect(
    fake.adapter.runTest(
      HOME,
      { model: "flash-family", reasoningEffort: "low" },
      fake.signal,
    ),
  ).resolves.toMatchObject({ ok: false, errorCode: "cli_check_failed" });
});
