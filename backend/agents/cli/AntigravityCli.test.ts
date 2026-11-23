import { RequestError } from "@agentclientprotocol/sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AntigravityCli } from "@/backend/agents/cli/AntigravityCli";
import { AgentError } from "@/backend/error/AgentErrors";

import type {
  CliHome,
  CliProcessResult,
} from "@/backend/agents/cli/CliContracts";
import type { CliToolExecution } from "@/backend/agents/cli/CliToolExecution";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { Stats } from "node:fs";

const mocks = vi.hoisted(() => ({
  lstat: vi.fn(),
  logEvent: vi.fn(),
  requireConfiguration: vi.fn(),
  open: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ lstat: mocks.lstat }));
vi.mock("@/backend/logging/Logger", () => ({
  logEvent: mocks.logEvent,
  logCaughtError: vi.fn(),
}));
vi.mock("@/backend/agents/acp/AntigravityConfiguration", () => ({
  requireManagedAntigravityConfiguration: mocks.requireConfiguration,
}));
vi.mock("@/backend/agents/cli/AntigravityProtocol", () => ({
  AntigravityProtocol: { open: mocks.open },
  antigravityFailure: (error: unknown): string =>
    error instanceof AgentError ? error.code : "antigravity_acp_session_failed",
}));

const HOME: CliHome = {
  root: "/ctx",
  home: "/ctx/home",
  config: "/ctx/gemini",
  work: "/ctx/work",
};
const SIGNAL = new AbortController().signal;
const CHALLENGE =
  "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&state=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A41234%2F";

function selectOption(
  id: string,
  currentValue: string,
  values: readonly string[],
): SessionConfigOption {
  return {
    id,
    name: id,
    type: "select",
    currentValue,
    options: values.map((value) => ({ value, name: `Name ${value}` })),
  };
}

function fakeProtocol(): {
  initialize: ReturnType<typeof vi.fn>;
  newSession: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  test: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  connection: { agent: { request: ReturnType<typeof vi.fn> } };
} {
  return {
    initialize: vi.fn().mockResolvedValue({
      agentInfo: { name: "Antigravity ACP Server", version: "1.6.0" },
    }),
    newSession: vi
      .fn()
      .mockResolvedValue({ sessionId: "s1", configOptions: [] }),
    select: vi.fn().mockResolvedValue([]),
    test: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
    connection: { agent: { request: vi.fn().mockResolvedValue({}) } },
  };
}

function tokenFile(overrides: Partial<Record<string, unknown>> = {}): Stats {
  return {
    isFile: () => true,
    isSymbolicLink: () => false,
    ...overrides,
  } as unknown as Stats;
}

function cli(execution: Partial<Record<string, unknown>> = {}): AntigravityCli {
  return new AntigravityCli(execution as unknown as CliToolExecution);
}

let protocol: ReturnType<typeof fakeProtocol>;

beforeEach(() => {
  protocol = fakeProtocol();
  mocks.open.mockResolvedValue(protocol);
  mocks.lstat.mockResolvedValue(tokenFile());
  mocks.requireConfiguration.mockResolvedValue(undefined);
});

afterEach(() => {
  mocks.lstat.mockReset();
  mocks.open.mockReset();
  mocks.requireConfiguration.mockReset();
});

it("reports the version of the handshake and closes the protocol", async () => {
  await expect(cli().version(HOME, SIGNAL)).resolves.toEqual({
    ok: true,
    detail: { cliVersion: "1.6.0" },
  });
  expect(protocol.close).toHaveBeenCalledOnce();
});

it("reports a failure of the handshake with its stable code", async () => {
  protocol.initialize.mockRejectedValue(
    new AgentError("antigravity_acp_unsupported"),
  );

  await expect(cli().version(HOME, SIGNAL)).resolves.toEqual({
    ok: false,
    errorCode: "antigravity_acp_unsupported",
    detail: {},
  });
  expect(protocol.close).toHaveBeenCalledOnce();
});

it("reports an unmanaged configuration without opening a protocol", async () => {
  mocks.requireConfiguration.mockRejectedValue(
    new AgentError("antigravity_configuration_unmanaged"),
  );

  await expect(cli().version(HOME, SIGNAL)).resolves.toMatchObject({
    ok: false,
    errorCode: "antigravity_configuration_unmanaged",
  });
  expect(mocks.open).not.toHaveBeenCalled();
});

it("reads the status from a real session", async () => {
  await expect(cli().readStatus(HOME, SIGNAL)).resolves.toEqual({
    outcome: { ok: true, detail: { authMethod: "oauth-personal" } },
    accountLabel: null,
  });
  expect(protocol.newSession).toHaveBeenCalledWith(HOME);
});

it.each([
  ["missing", () => mocks.lstat.mockRejectedValue(new Error("ENOENT"))],
  [
    "not a file",
    () => mocks.lstat.mockResolvedValue(tokenFile({ isFile: () => false })),
  ],
  [
    "a symbolic link",
    () =>
      mocks.lstat.mockResolvedValue(tokenFile({ isSymbolicLink: () => true })),
  ],
])("reports no sign-in when the token is %s", async (label, arrange) => {
  arrange();

  await expect(cli().readStatus(HOME, SIGNAL)).resolves.toMatchObject({
    outcome: { ok: false, errorCode: "cli_not_logged_in" },
  });
});

it("revokes the account when logout is advertised", async () => {
  protocol.initialize.mockResolvedValue({
    agentCapabilities: { auth: { logout: {} } },
  });

  await expect(cli().logout(HOME, SIGNAL)).resolves.toEqual({
    ok: true,
    detail: {},
  });
  expect(protocol.connection.agent.request).toHaveBeenCalledWith("logout", {});
});

it.each([[{}], [{ agentCapabilities: { auth: {} } }]])(
  "refuses when logout is not advertised",
  async (response) => {
    protocol.initialize.mockResolvedValue(response);

    await expect(cli().logout(HOME, SIGNAL)).resolves.toMatchObject({
      ok: false,
      errorCode: "antigravity_acp_unsupported",
    });
    expect(protocol.connection.agent.request).not.toHaveBeenCalled();
  },
);

const result: CliProcessResult = {
  exitCode: 1,
  stdout: "",
  stderr: "",
  errorCode: null,
};

it("keeps a stable code and defaults to a failed login", () => {
  expect(cli().loginError({ ...result, errorCode: "login_cancelled" })).toBe(
    "login_cancelled",
  );
  expect(cli().loginError(result)).toBe("login_failed");
});

function runningLogin(): {
  completed: Promise<CliProcessResult>;
  cancel: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
} {
  return {
    completed: Promise.resolve({
      exitCode: 0,
      stdout: "",
      stderr: "",
      errorCode: null,
    }),
    cancel: vi.fn(),
    write: vi.fn().mockReturnValue(true),
  };
}

it("starts the headless login after the configuration check", async () => {
  const running = runningLogin();
  const startLogin = vi
    .fn<
      (
        home: CliHome,
        request: {
          arguments: string[];
          onChallenge: unknown;
          parse: (output: string) => unknown;
        },
      ) => unknown
    >()
    .mockReturnValue(running);
  const onChallenge = vi.fn();
  const login = cli({ startLogin }).startLogin(HOME, onChallenge);

  await expect(login.completed).resolves.toMatchObject({ exitCode: 0 });

  const request = startLogin.mock.calls[0][1];
  expect(request.arguments).toEqual([
    "acp",
    "--login",
    "--gemini-dir=/ctx/gemini",
    "--app-data-dir=antigravity-acp",
    "--disable-telemetry",
  ]);
  expect(request.onChallenge).toBe(onChallenge);
  expect(request.parse(CHALLENGE)).toEqual({ verificationUrl: CHALLENGE });
});

it("forwards a cancel and the pasted code once the login runs", async () => {
  const running = runningLogin();
  const login = cli({
    startLogin: vi.fn().mockReturnValue(running),
  }).startLogin(HOME, vi.fn());
  await login.completed;

  login.cancel("login_cancelled");

  expect(running.cancel).toHaveBeenCalledWith("login_cancelled");
  expect(login.write("code")).toBe(true);
  expect(running.write).toHaveBeenCalledWith("code");
});

it("refuses a pasted code before the login runs", () => {
  const login = cli({
    startLogin: vi.fn().mockReturnValue(runningLogin()),
  }).startLogin(HOME, vi.fn());

  expect(login.write("code")).toBe(false);
});

it("starts nothing when the login was cancelled during the check", async () => {
  const startLogin = vi.fn();
  const login = cli({ startLogin }).startLogin(HOME, vi.fn());

  login.cancel("login_cancelled");

  await expect(login.completed).resolves.toEqual({
    exitCode: 1,
    stdout: "",
    stderr: "",
    errorCode: "login_cancelled",
  });
  expect(startLogin).not.toHaveBeenCalled();
});

it.each([
  [
    new AgentError("antigravity_configuration_unmanaged"),
    "antigravity_configuration_unmanaged",
  ],
  [new Error("boom"), "login_failed"],
])("refuses a login with an unusable configuration", async (error, code) => {
  mocks.requireConfiguration.mockRejectedValue(error);

  await expect(
    cli({ startLogin: vi.fn() }).startLogin(HOME, vi.fn()).completed,
  ).resolves.toMatchObject({ exitCode: 1, errorCode: code });
});

const picker = (
  entries: readonly object[],
  id = "model",
): SessionConfigOption =>
  ({
    id,
    name: id,
    type: "select",
    currentValue: "a",
    options: entries,
  }) as unknown as SessionConfigOption;

function offer(...entries: readonly object[]): void {
  protocol.newSession.mockResolvedValue({
    sessionId: "s1",
    configOptions: [picker(entries)],
  });
}

it("lists every model, also those inside groups, with their thinking levels", async () => {
  offer(
    { value: "gemini-pro", name: "Gemini Pro" },
    {
      group: "g",
      name: "Group",
      options: [{ value: "claude-x", name: "Claude X" }],
    },
  );
  protocol.select
    .mockResolvedValueOnce([
      selectOption("thought_level", "high", ["low", "high"]),
    ])
    .mockResolvedValueOnce([]);

  const models = await cli().listModels(HOME, SIGNAL);

  expect(models).toEqual([
    expect.objectContaining({
      id: "gemini-pro",
      name: "Gemini Pro",
      reasoning: "levels",
      reasoningEfforts: ["low", "high"],
      defaultReasoningEffort: "high",
    }),
    expect.objectContaining({
      id: "claude-x",
      reasoning: "unknown",
      reasoningEfforts: [],
    }),
  ]);
  expect(protocol.close).toHaveBeenCalledOnce();
});

it("leaves out a selector Pages cannot accept and a refused selection", async () => {
  offer(
    { value: "bad selector!", name: "Bad" },
    { value: "refused", name: "Refused" },
    { value: "rejected", name: "Rejected" },
    { value: "fine", name: "Fine" },
  );
  protocol.select
    .mockRejectedValueOnce(new AgentError("plan_model_unavailable"))
    .mockRejectedValueOnce(new RequestError(-32602, "no"))
    .mockResolvedValueOnce([]);

  const models = await cli().listModels(HOME, SIGNAL);

  expect(models.map((model) => model.id)).toEqual(["fine"]);
  expect(mocks.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "antigravity.catalog.model_skipped",
      metadata: { provider: "antigravity", reason: "selector_invalid" },
    }),
  );
  expect(mocks.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      metadata: { provider: "antigravity", reason: "plan_model_unavailable" },
    }),
  );
  expect(mocks.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      metadata: { provider: "antigravity", reason: "selection_refused" },
    }),
  );
});

it("fails the listing when the session itself fails", async () => {
  offer({ value: "a", name: "A" });
  protocol.select.mockRejectedValue(new Error("connection closed"));

  await expect(cli().listModels(HOME, SIGNAL)).rejects.toThrow(
    "connection closed",
  );
});

it("fails the listing at an abort even for a refusal", async () => {
  offer({ value: "a", name: "A" });
  const controller = new AbortController();
  controller.abort();
  protocol.select.mockRejectedValue(new AgentError("plan_model_unavailable"));

  await expect(cli().listModels(HOME, controller.signal)).rejects.toMatchObject(
    { code: "plan_model_unavailable" },
  );
});

it("fails when no model is usable", async () => {
  offer({ value: "bad selector!", name: "Bad" });

  await expect(cli().listModels(HOME, SIGNAL)).rejects.toMatchObject({
    code: "cli_unexpected_output",
  });
});

it.each([
  ["no model picker", undefined],
  ["a picker of another id", [picker([{ value: "a", name: "A" }], "mode")]],
  ["an empty picker", [picker([])]],
  [
    "an oversized picker",
    [
      picker(
        Array.from({ length: 1001 }, (entry, index) => ({
          value: `m${index}`,
          name: "M",
        })),
      ),
    ],
  ],
  [
    "a picker that is no select",
    [{ id: "model", name: "model", type: "boolean", currentValue: true }],
  ],
])("fails for %s", async (label, configOptions) => {
  protocol.newSession.mockResolvedValue({ sessionId: "s1", configOptions });

  await expect(cli().listModels(HOME, SIGNAL)).rejects.toMatchObject({
    code: "cli_unexpected_output",
  });
});

it("requires a sign-in before anything else", async () => {
  mocks.lstat.mockRejectedValue(new Error("ENOENT"));

  await expect(cli().listModels(HOME, SIGNAL)).rejects.toMatchObject({
    code: "cli_not_logged_in",
  });
  expect(mocks.open).not.toHaveBeenCalled();
});

const modelOptions = [selectOption("model", "m1", ["m1"])];
const echoed = [
  selectOption("model", "m1", ["m1"]),
  selectOption("thought_level", "high", ["high"]),
];

beforeEach(() => {
  protocol.newSession.mockResolvedValue({
    sessionId: "s1",
    configOptions: modelOptions,
  });
  protocol.select.mockResolvedValue(echoed);
});

it("selects model, effort and mode and sends the check", async () => {
  await expect(
    cli().runTest(HOME, { model: "m1", reasoningEffort: "high" }, SIGNAL),
  ).resolves.toEqual({
    ok: true,
    detail: { model: "m1", reasoningEffort: "high" },
  });
  expect(protocol.select.mock.calls.map((call) => call[2].id)).toEqual([
    "model",
    "thought_level",
    "mode",
  ]);
  expect(protocol.test).toHaveBeenCalledWith("s1", "Reply with exactly: OK");
});

it("checks a model without an effort", async () => {
  await expect(
    cli().runTest(HOME, { model: "m1", reasoningEffort: null }, SIGNAL),
  ).resolves.toEqual({ ok: true, detail: { model: "m1" } });
  expect(protocol.select).toHaveBeenCalledTimes(2);
});

it("falls back to an empty option list for a session without options", async () => {
  protocol.newSession.mockResolvedValue({ sessionId: "s1" });

  await cli().runTest(HOME, { model: "m1", reasoningEffort: null }, SIGNAL);

  expect(protocol.select.mock.calls[0][1]).toEqual([]);
});

it("requires a model", async () => {
  await expect(
    cli().runTest(HOME, { model: null, reasoningEffort: null }, SIGNAL),
  ).resolves.toMatchObject({
    ok: false,
    errorCode: "plan_model_unavailable",
  });
});

it.each([
  [
    "the model changed",
    [selectOption("model", "other", ["other"])],
    "m1",
    null,
  ],
  [
    "the effort changed",
    [
      selectOption("model", "m1", ["m1"]),
      selectOption("thought_level", "low", ["low"]),
    ],
    "m1",
    "high",
  ],
  [
    "the effort disappeared",
    [selectOption("model", "m1", ["m1"])],
    "m1",
    "high",
  ],
])("refuses when %s", async (label, options, model, reasoningEffort) => {
  protocol.select.mockResolvedValue(options);

  await expect(
    cli().runTest(HOME, { model, reasoningEffort }, SIGNAL),
  ).resolves.toMatchObject({ ok: false, errorCode: "plan_context_changed" });
});

it("fails when the model does not answer OK", async () => {
  protocol.test.mockResolvedValue(false);

  await expect(
    cli().runTest(HOME, { model: "m1", reasoningEffort: "high" }, SIGNAL),
  ).resolves.toMatchObject({ ok: false, errorCode: "cli_check_failed" });
});
