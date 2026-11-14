import { beforeEach, expect, it, vi } from "vitest";

import { CliSessionExecution } from "@/backend/agents/cli/CliSessionExecution";
import { CliIsolationGate } from "@/backend/agents/cli/CliIsolationGate";
import { CliSessionProcess } from "@/backend/agents/cli/CliSessionProcess";
import { openCodeCredentials } from "@/backend/agents/cli/OpenCodeCredentialStore";
import { requireAcpIsolation } from "@/backend/agents/cli/CliSessionPlans";
import { acpRunOptions } from "@/definition/AgentConfiguration";

import { sessionInput } from "./cli-session-input";
import { bareInstance } from "../../service/tasks/bare-instance";

import type { AcpSessionContext } from "@/backend/agents/acp/AcpSessionContracts";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { Mock } from "vitest";
import type {
  CliSessionRequest,
  CliHome,
  CliCredentialAccess,
  CliToolAdapter,
} from "@/backend/agents/cli/CliContracts";

const native = vi.hoisted(() => ({ contexts: [] as AcpSessionContext[] }));
// No ACP client, transport, server or native process starts in this unit scope.
vi.mock("@/backend/agents/acp/AcpSession", () => ({
  AcpSession: class {
    public readonly turn = Promise.resolve({ failure: null });
    public constructor(
      _process: unknown,
      _stream: unknown,
      context: AcpSessionContext,
    ) {
      native.contexts.push(context);
    }
    public async close(): Promise<unknown> {
      return { isConfirmed: true };
    }
  },
}));
vi.mock("@/backend/agents/acp/OpenCodeAcpConfiguration", () => ({
  requireManagedOpenCodeConfiguration: vi.fn(async () => undefined),
}));
vi.mock("@/backend/agents/cli/CliAcpStartCleanup", () => ({
  cleanupFailedAcpStart: vi.fn(async () => undefined),
}));
vi.mock("@/backend/agents/cli/CliOwnedNamespace", () => ({
  captureOwnedNamespace: vi.fn(async () => ({
    pid: 411,
    uid: 1000,
    start: 1,
    boot: "synthetic",
  })),
}));
vi.mock("@/backend/agents/cli/CliSessionChannel", () => ({
  connectChild: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
}));

const HOME = {
  root: "/synthetic/selected",
  home: "/synthetic/selected/home",
  config: "/synthetic/selected/opencode",
  work: "/synthetic/work",
};
const KEY = "synthetic-selected-key-411";

beforeEach(() => {
  vi.restoreAllMocks();
  native.contexts.length = 0;
});

function world(): {
  readonly execution: CliSessionExecution;
  readonly spawn: Mock<(request: CliSessionRequest) => CliSessionProcess>;
  readonly prepare: Mock<() => Promise<CliHome>>;
  readonly readOwn: Mock<() => Promise<never>>;
  readonly apiCredentials: Mock<
    (connection: AgentConnectionRecord) => Promise<CliCredentialAccess>
  >;
} {
  const readOwn = vi.fn(async () => {
    throw new Error("An API agent must not read OpenCode's own keys");
  });
  const adapter: CliToolAdapter = {
    provider: "opencode",
    readStatus: readOwn,
    version: async () => ({ ok: true, detail: {} }),
    listModels: async () => [],
    runTest: async () => ({ ok: true, detail: {} }),
    logout: async () => ({ ok: true, detail: {} }),
  };
  const prepare = vi.fn(async () => HOME);
  const apiCredentials = vi.fn(async (connection: AgentConnectionRecord) =>
    openCodeCredentials({ modelProvider: connection.provider, apiKey: KEY }),
  );
  const process = bareInstance(CliSessionProcess.prototype);
  const spawn = vi.fn((_request: CliSessionRequest) => process);
  vi.spyOn(process, "processId", "get").mockReturnValue(411);
  vi.spyOn(CliIsolationGate.prototype, "isolateSession").mockImplementation(
    async (request) => ({ request, isIsolated: true }),
  );
  const execution = new CliSessionExecution({
    runtime: { adapter: async () => adapter },
    apiCredentials,
    store: { prepare, secure: async () => undefined },
    locator: {
      find: async () => ({ found: true, path: "/synthetic/opencode" }),
      locate: async () => ({ found: true, path: "/synthetic/opencode" }),
    },
    runner: { startSession: spawn },
  });
  return { execution, spawn, prepare, readOwn, apiCredentials };
}

it.each(["openrouter", "zai"] as const)(
  "starts %s with exactly its connection key and native model; keeps public identity",
  async (provider) => {
    const { execution, spawn, prepare, readOwn, apiCredentials } = world();
    const base = sessionInput(provider, acpRunOptions("read_only", 7));
    const input = {
      ...base,
      agent: {
        ...base.agent,
        model: "deepseek/deepseek-v4.1-flash",
        reasoningEffort: "low",
      },
    };
    const observer = {
      started: vi.fn(),
      identified: vi.fn(),
      capabilities: vi.fn(),
    };
    const session = await execution.open(
      input,
      new AbortController().signal,
      observer,
    );
    expect(session).toBeDefined();
    expect(prepare).toHaveBeenCalledWith("connection", "opencode");
    expect(apiCredentials).toHaveBeenCalledWith(input.agent.connection);
    expect(readOwn).not.toHaveBeenCalled();
    const request = startedRequest(spawn);
    expect(request).toMatchObject({
      provider: "opencode",
      file: "/synthetic/opencode",
      arguments: ["acp", "--port", "0", "--hostname", "127.0.0.1"],
      isWorkingDirectoryReadOnly: true,
      timeoutMs: 420000,
    });
    expect(JSON.parse(request.environment.OPENCODE_AUTH_CONTENT)).toEqual({
      [provider]: { type: "api", key: KEY },
    });
    const config: unknown = JSON.parse(
      request.environment.OPENCODE_CONFIG_CONTENT,
    );
    expect(config).toMatchObject({
      model: `${provider}/${input.agent.model}`,
      small_model: `${provider}/${input.agent.model}`,
      enabled_providers: [provider],
      default_agent: "pages-read-only",
      agent: { "pages-read-only": { variant: "low" } },
    });
    expect(request.arguments.join(" ")).not.toContain(KEY);
    const context = native.contexts[0];
    expect(context?.request.model).toBe(`${provider}/${input.agent.model}`);
    const label = provider === "openrouter" ? "OpenRouter" : "z.AI";
    expect(
      context?.redact?.(`OpenCode ${provider}/${input.agent.model} ${KEY}`),
    ).toBe(`${label} ${input.agent.model} [redacted]`);
    expect(context?.profile.unattended).not.toContain("OpenCode");
    expect(input.agent.connection.provider).toBe(provider);
    expect(input.agent.model).toBe("deepseek/deepseek-v4.1-flash");
  },
);

it.each(["openrouter", "zai"] as const)(
  "uses the same isolation and YOLO permissions for %s",
  async (provider) => {
    const { execution, spawn } = world();
    const input = sessionInput(provider, acpRunOptions("yolo", 0));
    expect(() => requireAcpIsolation(false, "read_only", input)).toThrow();
    expect(() => requireAcpIsolation(false, "yolo", input)).toThrow();
    await execution.open(input, new AbortController().signal, {
      started: vi.fn(),
      identified: vi.fn(),
    });
    const request = startedRequest(spawn);
    expect(request.isWorkingDirectoryReadOnly).toBe(false);
    const configuration: unknown = JSON.parse(
      request.environment.OPENCODE_CONFIG_CONTENT,
    );
    expect(configuration).toMatchObject({
      default_agent: "pages-yolo",
      permission: { "*": "allow", read: { "*.env": "deny" } },
    });
  },
);

it("keeps the z.AI coding-plan endpoint without changing the catalog ID or native prefix", async () => {
  const { execution, spawn } = world();
  const base = sessionInput("zai", acpRunOptions("read_only", 0));
  const input = {
    ...base,
    agent: {
      ...base.agent,
      model: "glm-5",
      connection: {
        ...base.agent.connection,
        zaiAccountType: "coding-plan" as const,
      },
    },
  };
  await execution.open(input, new AbortController().signal, {
    started: vi.fn(),
    identified: vi.fn(),
  });
  const configuration: unknown = JSON.parse(
    startedRequest(spawn).environment.OPENCODE_CONFIG_CONTENT,
  );
  expect(configuration).toMatchObject({
    model: "zai/glm-5",
    provider: {
      zai: { options: { baseURL: "https://api.z.ai/api/coding/paas/v4" } },
    },
  });
});

function startedRequest(
  spawn: Mock<(request: CliSessionRequest) => CliSessionProcess>,
): CliSessionRequest {
  const request = spawn.mock.calls[0]?.[0];
  if (!request) throw new Error("Synthetic worker was not started");
  return request;
}

it.each(["openrouter", "zai"] as const)(
  "refuses host login inheritance and API chat execution for %s",
  async (provider) => {
    const { execution, spawn, apiCredentials } = world();
    const signal = new AbortController().signal;
    const observer = { started: vi.fn(), identified: vi.fn() };
    await expect(
      execution.open(
        sessionInput(provider, acpRunOptions("full_environment", 0)),
        signal,
        observer,
      ),
    ).rejects.toMatchObject({ code: "plan_run_option_unsupported" });
    const chat = {
      resumeSessionId: null,
      listener: { update: vi.fn(), prompted: vi.fn(), closed: vi.fn() },
    };
    await expect(
      execution.open(
        sessionInput(provider, acpRunOptions("read_only", 0), { chat }),
        signal,
        observer,
      ),
    ).rejects.toMatchObject({ code: "provider_invalid" });
    expect(apiCredentials).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  },
);
