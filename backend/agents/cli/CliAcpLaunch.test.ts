import { expect, it, vi } from "vitest";

import {
  acpMcpServers,
  acpSessionRequest,
  acpWorkerRequest,
  isolationLabel,
  picaNativeRunner,
  planAcpLaunch,
} from "@/backend/agents/cli/CliAcpLaunch";
import { CLI_DEFAULT_RUNTIME_MS } from "@/backend/agents/cli/CliPausableDeadline";

import type { McpServer } from "@agentclientprotocol/sdk";
import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AcpDriver } from "@/backend/agents/acp/AcpDriver";
import type { AcpLaunch } from "@/backend/agents/acp/AcpLaunch";
import type { AcpWorkerParts } from "@/backend/agents/cli/CliAcpLaunch";
import type { PicaCodexBundle } from "@/backend/agents/cli/PicaCodexBundle";
import type { PicaNativeArtifact } from "@/backend/agents/cli/PicaNativeArtifact";

/** Casts a partial stand-in to the type the code under test expects. */
function fake<T>(value: object): T {
  return value as T;
}

const HOME = { root: "/r", home: "/h", config: "/c", work: "/w" };
const BUNDLE = fake<PicaCodexBundle>({
  entry: "/bundle/entry.mjs",
  directory: "/bundle",
  packageRoot: "/package",
  runnerRoot: "/runner",
});
const NATIVE = fake<PicaNativeArtifact>({
  executable: "/native/pica",
  runner: "codex",
});

function sessionInput(parts: object = {}): AgentPlanSessionInput {
  return fake<AgentPlanSessionInput>({
    directory: "/work",
    instanceId: "instance",
    options: { timeoutMinutes: 0 },
    agent: {
      connection: { provider: "opencode" },
      model: "model",
      reasoningEffort: "high",
      supportsImages: true,
    },
    prompt: "prompt",
    ...parts,
  });
}

function workerParts(parts: object = {}): AcpWorkerParts {
  return fake<AcpWorkerParts>({
    driver: { arguments: ["--acp"] },
    input: sessionInput(),
    mode: "yolo",
    launch: { environment: { BASE: "1" } },
    adapter: "/adapter",
    provider: "claude_code",
    home: HOME,
    github: null,
    picaNative: null,
    picaBundle: null,
    signal: new AbortController().signal,
    onLine: vi.fn(),
    ...parts,
  });
}

it("runs the adapter with the driver arguments of the home", () => {
  const launchArguments = vi.fn(() => ["--home"]);
  const request = acpWorkerRequest(
    workerParts({ driver: { launchArguments, arguments: ["ignored"] } }),
  );
  expect(launchArguments).toHaveBeenCalledWith(HOME);
  expect(request).toMatchObject({
    file: "/adapter",
    arguments: ["--home"],
    readOnlyFiles: [],
    workingDirectory: "/work",
    isWorkingDirectoryReadOnly: false,
    pausesRuntime: false,
    timeoutMs: 0,
    environment: { BASE: "1" },
  });
});

it("falls back to the plain driver arguments, then to none", () => {
  expect(acpWorkerRequest(workerParts()).arguments).toEqual(["--acp"]);
  expect(acpWorkerRequest(workerParts({ driver: {} })).arguments).toEqual([]);
});

it("runs the native Pica build and keeps the browser state readable", () => {
  const request = acpWorkerRequest(
    workerParts({
      picaNative: { executable: "/native/opencode", runner: "opencode" },
      mode: "read_only",
      input: sessionInput({
        chat: { browserStateDirectory: "/browser" },
        options: { timeoutMinutes: 2 },
      }),
    }),
  );
  expect(request).toMatchObject({
    file: "/native/opencode",
    readOnlyFiles: ["/browser"],
    isWorkingDirectoryReadOnly: true,
    timeoutMs: 120_000,
    environment: { BASE: "1", PAGES_PICA_OPENCODE: "1" },
  });
});

it("runs a Pica Codex bundle with the host runtime and read-only mounts", () => {
  const request = acpWorkerRequest(
    workerParts({
      picaBundle: BUNDLE,
      picaNative: NATIVE,
      input: sessionInput({ chat: {} }),
    }),
  );
  expect(request).toMatchObject({
    file: process.execPath,
    arguments: ["/bundle/entry.mjs", "--acp"],
    readOnlyFiles: ["/bundle", "/package", "/runner", process.execPath],
    isWorkingDirectoryReadOnly: true,
    environment: {
      BASE: "1",
      CODEX_PATH: "/native/pica",
      PAGES_PICA_CODEX: "1",
    },
  });
  expect(
    acpWorkerRequest(workerParts({ picaBundle: BUNDLE })).environment,
  ).toEqual({ BASE: "1" });
});

it("adds credential and GitHub environment and the GitHub directory", () => {
  const environmentFor = vi.fn(() => ({ KEY: "value" }));
  const request = acpWorkerRequest(
    workerParts({
      input: sessionInput({
        agent: {
          connection: { provider: "openrouter" },
          model: "m",
        },
      }),
      credentials: { environmentFor },
      github: { environment: { GH: "1" }, directory: "/gh" },
    }),
  );
  expect(environmentFor).toHaveBeenCalledWith("openrouter");
  expect(request).toMatchObject({
    environment: { BASE: "1", KEY: "value", GH: "1" },
    credentialDirectory: "/gh",
  });
});

it("pauses the runtime of a Codex resource session only", () => {
  const resource = sessionInput({ resourceContext: {} });
  expect(
    acpWorkerRequest(workerParts({ provider: "codex_cli", input: resource })),
  ).toMatchObject({ pausesRuntime: true, timeoutMs: CLI_DEFAULT_RUNTIME_MS });
  expect(
    acpWorkerRequest(
      workerParts({
        provider: "codex_cli",
        input: sessionInput({ resourceContext: {}, chat: {} }),
      }),
    ).pausesRuntime,
  ).toBe(false);
  expect(
    acpWorkerRequest(
      workerParts({
        provider: "codex_cli",
        input: sessionInput({
          resourceContext: {},
          options: { timeoutMinutes: 1 },
        }),
      }),
    ).timeoutMs,
  ).toBe(60_000);
});

it("adds the browser server unless a native Pica build runs", () => {
  const launch = fake<AcpLaunch>({ mcpServers: [{ name: "a" }] });
  const browser = fake<McpServer>({ name: "browser" });
  expect(acpMcpServers(launch, browser, null)).toEqual([
    { name: "a" },
    { name: "browser" },
  ]);
  expect(acpMcpServers(launch, browser, NATIVE)).toBe(launch.mcpServers);
  expect(acpMcpServers(launch, null, null)).toBe(launch.mcpServers);
});

it("maps providers to their native Pica runner", () => {
  expect(picaNativeRunner("codex_cli")).toBe("codex");
  expect(picaNativeRunner("opencode")).toBe("opencode");
  expect(picaNativeRunner("claude_code")).toBeNull();
});

it("plans a launch with the purpose of the session", () => {
  const plan = vi.fn<AcpDriver["plan"]>(() => fake<AcpLaunch>({}));
  const driver = fake<AcpDriver>({ plan });
  const profile = fake<ReturnType<AcpDriver["profile"]>>({});
  planAcpLaunch(
    driver,
    sessionInput({ chat: {}, mcp: { token: "t" } }),
    "f",
    profile,
  );
  planAcpLaunch(driver, sessionInput({ purpose: "decision" }), "f", profile);
  planAcpLaunch(driver, sessionInput(), "f", profile);
  expect(plan.mock.calls.map(([call]) => call)).toMatchObject([
    {
      instanceId: "instance",
      runnerFile: "f",
      mcp: { token: "t" },
      purpose: "chat",
      model: { model: "model", reasoningEffort: "high" },
    },
    { purpose: "decision", mcp: null },
    { purpose: "plan" },
  ]);
});

it("builds the session request from the launch of a plan session", () => {
  const launch = fake<AcpLaunch>({
    mcpServers: [{ name: "launch" }],
    sessionMeta: { meta: true },
  });
  expect(
    acpSessionRequest(
      sessionInput({
        resumeSessionId: "resume",
        resourceContext: { sourceRunId: "run" },
      }),
      launch,
    ),
  ).toMatchObject({
    directory: "/work",
    model: "model",
    modelSupportsImages: true,
    mcpServers: [{ name: "launch" }],
    sessionMeta: { meta: true },
    canReplaceMissingSession: true,
    resumeSessionId: "resume",
  });
  expect(
    acpSessionRequest(sessionInput({ resourceContext: {} }), launch),
  ).toMatchObject({ canReplaceMissingSession: false, resumeSessionId: null });
});

it("lets a chat session bring its own servers and continuation", () => {
  expect(
    acpSessionRequest(
      sessionInput({
        chat: { mcpServers: [{ name: "chat" }], resumeSessionId: "chat-id" },
        resumeSessionId: "plan-id",
      }),
      fake<AcpLaunch>({ mcpServers: [] }),
    ),
  ).toMatchObject({
    mcpServers: [{ name: "chat" }],
    resumeSessionId: "chat-id",
  });
  expect(
    acpSessionRequest(
      sessionInput({ chat: {} }),
      fake<AcpLaunch>({ mcpServers: [{ name: "launch" }] }),
    ),
  ).toMatchObject({ mcpServers: [{ name: "launch" }], resumeSessionId: null });
});

it("describes the isolation as it really is", () => {
  const codex = fake<AcpDriver>({ provider: "codex_cli" });
  const other = fake<AcpDriver>({ provider: "opencode" });
  expect(isolationLabel(true, "yolo", codex)).toBe(
    "none: native host process with the rights of the account",
  );
  expect(isolationLabel(true, "read_only", codex)).toBe(
    "bubblewrap, host read-only",
  );
  expect(isolationLabel(false, "read_only", codex)).toBe(
    "none, the read-only Codex sandbox only",
  );
  expect(isolationLabel(false, "read_only", other)).toBe(
    "none, the read-only permission handling of Pages only",
  );
});
