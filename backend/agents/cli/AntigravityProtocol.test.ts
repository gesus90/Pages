import { RequestError } from "@agentclientprotocol/sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  AntigravityProtocol,
  antigravityFailure,
} from "@/backend/agents/cli/AntigravityProtocol";
import { AgentError } from "@/backend/error/AgentErrors";

import type { CliHome } from "@/backend/agents/cli/CliContracts";
import type { CliToolExecution } from "@/backend/agents/cli/CliToolExecution";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";

const mocks = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  readSpawnScope: vi.fn(),
  closeCliSession: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
  logEvent: vi.fn(),
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  readSpawnScope: mocks.readSpawnScope,
}));
vi.mock("@/backend/agents/cli/CliSessionCloseout", () => ({
  closeCliSession: mocks.closeCliSession,
}));

const HOME: CliHome = {
  root: "/ctx",
  home: "/ctx/home",
  config: "/ctx/gemini",
  work: "/ctx/work",
};
const CHALLENGE =
  "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&state=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A41234%2F";
const SCOPE = { earliestStart: 7 };

type Responder = (params: Record<string, unknown>) => unknown;

interface Harness {
  readonly execution: CliToolExecution;
  readonly child: {
    write: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    endInput: ReturnType<typeof vi.fn>;
    exited: Promise<unknown>;
  };
  readonly responders: Map<string, Responder>;
  readonly written: Record<string, unknown>[];
  readonly opened: () => {
    onLine: (line: string) => void;
    onStderr: (tail: string) => void;
    instanceId: string;
  };
  readonly emit: (message: Record<string, unknown>) => void;
  readonly endProcess: () => void;
}

/** A fake agent: answers each request line through the registered responder. */
function harness(beforeReturn?: (tail: string) => void): Harness {
  const responders = new Map<string, Responder>();
  const written: Record<string, unknown>[] = [];
  let endProcess: () => void = () => undefined;
  const exited = new Promise<void>((resolve) => {
    endProcess = resolve;
  });
  let captured: ReturnType<Harness["opened"]> | null = null;
  const emit = (message: Record<string, unknown>): void => {
    captured?.onLine(JSON.stringify({ jsonrpc: "2.0", ...message }));
  };
  const child = {
    write: vi.fn((line: string): boolean => {
      const message = JSON.parse(line) as Record<string, unknown>;
      written.push(message);
      const responder = responders.get(String(message.method));
      if (typeof message.method === "string" && responder)
        void (async () => {
          try {
            emit({
              id: message.id,
              result: await responder(
                message.params as Record<string, unknown>,
              ),
            });
          } catch (error: unknown) {
            if (!(error instanceof RequestError)) throw error;
            emit({
              id: message.id,
              error: { code: error.code, message: error.message },
            });
          }
        })();
      return true;
    }),
    cancel: vi.fn(),
    endInput: vi.fn(),
    exited,
  };
  const execution = {
    openProtocol: vi.fn((home: CliHome, options: never) => {
      captured = options;
      beforeReturn?.(CHALLENGE);
      return child;
    }),
  } as unknown as CliToolExecution;
  return {
    execution,
    child,
    responders,
    written,
    opened: () => captured as NonNullable<typeof captured>,
    emit,
    endProcess,
  };
}

const SUPPORTED = {
  protocolVersion: 1,
  agentInfo: { name: "Antigravity ACP Server", version: "1.5.9" },
  authMethods: [{ id: "oauth-personal", name: "Google" }],
};

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
    options: values.map((value) => ({ value, name: value })),
  };
}

async function open(
  test: Harness,
  onStderr?: (tail: string) => void,
): Promise<AntigravityProtocol> {
  return AntigravityProtocol.open(test.execution, HOME, {
    signal: new AbortController().signal,
    onStderr,
  });
}

beforeEach(() => {
  mocks.readSpawnScope.mockResolvedValue(SCOPE);
  mocks.closeCliSession.mockResolvedValue({ isConfirmed: true });
});

afterEach(() => {
  mocks.logCaughtError.mockReset();
});

it("opens the process with a line channel and closes it when it exits", async () => {
  const test = harness();
  const protocol = await open(test);
  test.responders.set("initialize", () => SUPPORTED);

  await expect(protocol.initialize()).resolves.toMatchObject(SUPPORTED);
  expect(test.written[0]).toMatchObject({
    method: "initialize",
    params: { protocolVersion: 1 },
  });
  expect(mocks.readSpawnScope).toHaveBeenCalledOnce();

  test.endProcess();
  await expect(protocol.initialize()).rejects.toBeInstanceOf(Error);
});

it("forwards the stderr tail to a caller that reads it", async () => {
  const test = harness();
  const onStderr = vi.fn();
  await open(test, onStderr);

  test.opened().onStderr("tail");

  expect(onStderr).toHaveBeenCalledWith("tail");
  expect(test.child.cancel).not.toHaveBeenCalled();
});

it("ignores a stderr tail without a sign-in challenge", async () => {
  const test = harness();
  await open(test);

  test.opened().onStderr("a warning");

  expect(test.child.cancel).not.toHaveBeenCalled();
});

it("does not mark a protocol that does not exist yet when a challenge arrives early", async () => {
  // The handle of the process is not assigned yet, so the handler fails.
  const test = harness((tail) => {
    expect(() => test.opened().onStderr(tail)).toThrow(ReferenceError);
  });
  await open(test);

  expect(test.child.cancel).not.toHaveBeenCalled();
});

it("marks the challenge on an existing protocol and reports the sign-in", async () => {
  const test = harness();
  const protocol = await open(test);
  test.opened().onStderr(CHALLENGE);

  expect(test.child.cancel).toHaveBeenCalledWith("cli_not_logged_in");
  test.responders.set("session/new", () => {
    throw RequestError.internalError();
  });
  await expect(protocol.newSession(HOME)).rejects.toMatchObject({
    code: "cli_not_logged_in",
  });
});

async function initializeWith(response: unknown): Promise<unknown> {
  const test = harness();
  const protocol = await open(test);
  test.responders.set("initialize", () => response);
  return protocol.initialize().then(
    () => null,
    (error: unknown) => error,
  );
}

it.each([
  ["another protocol version", { ...SUPPORTED, protocolVersion: 2 }],
  [
    "another adapter",
    { ...SUPPORTED, agentInfo: { name: "Other", version: "1.5.9" } },
  ],
  ["a missing adapter identity", { ...SUPPORTED, agentInfo: undefined }],
  ["no advertised methods", { ...SUPPORTED, authMethods: undefined }],
  [
    "another advertised method",
    { ...SUPPORTED, authMethods: [{ id: "api-key", name: "Key" }] },
  ],
])("refuses %s", async (label, response) => {
  await expect(initializeWith(response)).resolves.toMatchObject({
    code: "antigravity_acp_unsupported",
  });
});

it("opens a session without native tools in the work directory", async () => {
  const test = harness();
  const protocol = await open(test);
  test.responders.set("session/new", () => ({ sessionId: "s1" }));

  await expect(protocol.newSession(HOME)).resolves.toMatchObject({
    sessionId: "s1",
  });
  expect(test.written[0]).toMatchObject({
    params: {
      cwd: "/ctx/work",
      mcpServers: [],
      _meta: { antigravity: { enabledTools: [] } },
    },
  });
});

it("passes on a failure without a sign-in challenge", async () => {
  const test = harness();
  const protocol = await open(test);
  test.responders.set("session/new", () => {
    throw RequestError.internalError();
  });

  await expect(protocol.newSession(HOME)).rejects.toBeInstanceOf(RequestError);
});

const options = [selectOption("model", "a", ["a", "b"])];
const selection = {
  id: "model",
  value: "b",
  error: "plan_model_unavailable",
} as const;

it("selects an offered value and returns the echoed options", async () => {
  const test = harness();
  const protocol = await open(test);
  const echoed = [selectOption("model", "b", ["a", "b"])];
  test.responders.set("session/set_config_option", () => ({
    configOptions: echoed,
  }));

  await expect(protocol.select("s1", options, selection)).resolves.toEqual(
    echoed,
  );
  expect(test.written[0]).toMatchObject({
    params: { sessionId: "s1", configId: "model", value: "b" },
  });
});

it.each([
  ["an unknown option", [selectOption("mode", "a", ["b"])]],
  ["an unoffered value", [selectOption("model", "a", ["a"])]],
])("refuses %s", async (label, offered) => {
  const protocol = await open(harness());

  await expect(protocol.select("s1", offered, selection)).rejects.toMatchObject(
    { code: "plan_model_unavailable" },
  );
});

it("refuses a value the adapter remapped", async () => {
  const test = harness();
  const protocol = await open(test);
  test.responders.set("session/set_config_option", () => ({
    configOptions: [selectOption("model", "a", ["a", "b"])],
  }));

  await expect(protocol.select("s1", options, selection)).rejects.toMatchObject(
    { code: "plan_model_unavailable" },
  );
});

it("refuses an answer without the option", async () => {
  const test = harness();
  const protocol = await open(test);
  test.responders.set("session/set_config_option", () => ({
    configOptions: [],
  }));

  await expect(protocol.select("s1", options, selection)).rejects.toMatchObject(
    { code: "plan_model_unavailable" },
  );
});

async function answer(
  chunks: readonly Record<string, unknown>[],
  stopReason = "end_turn",
): Promise<boolean> {
  const test = harness();
  const protocol = await open(test);
  test.responders.set("session/prompt", () => {
    for (const update of chunks)
      test.emit({
        method: "session/update",
        params: { sessionId: "s1", update },
      });
    return new Promise((resolve) => {
      setImmediate(() => resolve({ stopReason }));
    });
  });
  const outcome = protocol.test("s1", "Reply OK");
  return outcome;
}

const text = (value: string): Record<string, unknown> => ({
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text: value },
});

it("accepts the exact answer OK of a finished turn", async () => {
  await expect(answer([text(" O"), text("K\n")])).resolves.toBe(true);
});

it.each([
  ["another answer", [text("no")], "end_turn"],
  ["a turn that did not end normally", [text("OK")], "max_tokens"],
  ["an oversized answer", [text("x".repeat(70000))], "end_turn"],
  [
    "an answer without text",
    [
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "image", data: "AA==", mimeType: "image/png" },
      },
      {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "OK" },
      },
    ],
    "end_turn",
  ],
])("rejects %s", async (label, chunks, stopReason) => {
  await expect(answer(chunks, stopReason)).resolves.toBe(false);
});

it("starts every check with an empty answer", async () => {
  const test = harness();
  const protocol = await open(test);
  let turn = 0;
  test.responders.set("session/prompt", () => {
    turn += 1;
    test.emit({
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: turn === 1 ? "x".repeat(70000) : "OK",
          },
        },
      },
    });
    return new Promise((resolve) => {
      setImmediate(() => resolve({ stopReason: "end_turn" }));
    });
  });

  await expect(protocol.test("s1", "p")).resolves.toBe(false);
  await expect(protocol.test("s1", "p")).resolves.toBe(true);
});

it("cancels every permission request of the adapter", async () => {
  const test = harness();
  await open(test);

  test.emit({
    id: "perm-1",
    method: "session/request_permission",
    params: {
      sessionId: "s1",
      toolCall: { toolCallId: "t1" },
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
    },
  });

  await vi.waitFor(() =>
    expect(test.written).toContainEqual({
      jsonrpc: "2.0",
      id: "perm-1",
      result: { outcome: { outcome: "cancelled" } },
    }),
  );
});

it("closes the connection and the process and confirms the closeout", async () => {
  const test = harness();
  const protocol = await open(test);

  await expect(protocol.close()).resolves.toBeUndefined();

  expect(test.child.cancel).toHaveBeenCalledWith("login_cancelled");
  expect(mocks.closeCliSession).toHaveBeenCalledWith(
    test.child,
    test.opened().instanceId,
    SCOPE,
    "pid_namespace",
  );
});

it("fails when the closeout is not confirmed", async () => {
  mocks.closeCliSession.mockResolvedValue({ isConfirmed: false });
  const protocol = await open(harness());

  await expect(protocol.close()).rejects.toMatchObject({
    code: "credential_cleanup_failed",
  });
});

const live = new AbortController().signal;

it("maps a timeout abort", () => {
  const controller = new AbortController();
  controller.abort(new DOMException("late", "TimeoutError"));

  expect(antigravityFailure(new Error("x"), controller.signal)).toBe(
    "check_timeout",
  );
});

it.each([
  ["another DOMException", new DOMException("x", "AbortError")],
  ["a plain reason", "stop"],
])("maps an abort with %s to a cancelled login", (label, reason) => {
  const controller = new AbortController();
  controller.abort(reason);

  expect(antigravityFailure(new Error("x"), controller.signal)).toBe(
    "login_cancelled",
  );
});

it("keeps the code of an agent error", () => {
  expect(antigravityFailure(new AgentError("cli_check_failed"), live)).toBe(
    "cli_check_failed",
  );
});

it("maps the authentication request error to a missing sign-in", () => {
  expect(
    antigravityFailure(new RequestError(-32000, "auth required"), live),
  ).toBe("cli_not_logged_in");
});

it("classifies the message of another error", () => {
  expect(antigravityFailure(new Error("HTTP 429"), live)).toBe(
    "provider_rate_limited",
  );
});

it("maps a generic session failure to the adapter's own code", () => {
  expect(antigravityFailure(new Error("boom"), live)).toBe(
    "antigravity_acp_session_failed",
  );
  expect(antigravityFailure("not an error", live)).toBe(
    "antigravity_acp_session_failed",
  );
});

it("classifies a request error with another code by its message", () => {
  expect(antigravityFailure(new RequestError(-32603, "boom"), live)).toBe(
    "antigravity_acp_session_failed",
  );
});
