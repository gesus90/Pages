import { beforeEach, expect, it, vi } from "vitest";

import { AgentToolStartupService } from "@/backend/service/agents/tools/AgentToolStartupService";
import { prepareAgentToolSession } from "@/backend/service/agents/tools/AgentToolSession";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";

import { toolRuntimeWorld, toolSessionInput } from "./page69-runtime-world";
import { TOOL_ADMIN, toolWorld } from "./page69-tool-world";

import type { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";

vi.mock("node:fs/promises", () => ({
  access: async (file: string) => {
    if (file.endsWith("config.toml")) throw new Error("ENOENT");
  },
  realpath: async (file: string) => file,
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  RUN_INSTANCE_VARIABLE: "PAGES_RUN_INSTANCE",
  readServerScope: async () => ({ earliestStart: 0 }),
  endTaggedProcesses: async () => ({ found: 0, remaining: 0 }),
}));

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

it("uses managed Codex ACP through the existing engine with unchanged prompt, model and credentials", async () => {
  const { execution, fake, world, secure } = toolRuntimeWorld();
  const input = toolSessionInput();
  const login = structuredClone(input.agent.connection);
  const session = await execution.open(input, new AbortController().signal, {
    started: () => undefined,
    identified: () => undefined,
  });
  expect((await session.turn).failure).toBeNull();
  expect(fake.spawned[0]?.arguments.at(-1)).toContain("codex_acp");
  expect(fake.spawned[0]?.options.env?.CODEX_PATH).toContain("/codex/");
  expect(
    JSON.stringify(fake.calls.find((call) => call.method === "session/prompt")),
  ).toContain(input.prompt);
  expect(JSON.stringify(fake.calls)).toContain(input.agent.model);
  expect(input.agent.connection).toEqual(login);
  expect(world.manager.supervisor.activities("codex")).toMatchObject([
    { processId: 4242, sessionId: "thread-synthetic" },
  ]);
  expect((await session.close()).isConfirmed).toBe(true);
  expect(world.manager.supervisor.activities("codex")).toEqual([]);
  expect(secure).toHaveBeenCalled();
});

it("blocks the real session boundary before spawn or credential access when a dependency is missing", async () => {
  const { execution, fake, world, prepare } = toolRuntimeWorld();
  world.system.delete("bubblewrap");
  await expect(
    execution.open(toolSessionInput(), new AbortController().signal, {
      started: () => undefined,
      identified: () => undefined,
    }),
  ).rejects.toMatchObject({ tool: "bubblewrap", diagnostic: "not_installed" });
  expect(fake.spawned).toEqual([]);
  expect(prepare).not.toHaveBeenCalled();
});

it("ends the existing process group after cancellation and releases tools only after confirmed closeout", async () => {
  const { execution, fake, world } = toolRuntimeWorld();
  const controller = new AbortController();
  const session = await execution.open(toolSessionInput(), controller.signal, {
    started: () => undefined,
    identified: () => undefined,
  });
  await session.turn;
  controller.abort();
  const closed = await session.close();
  expect(closed).toMatchObject({
    isConfirmed: true,
    exit: { signal: "SIGTERM" },
  });
  expect(fake.spawned).toHaveLength(1);
  expect(world.manager.supervisor.activities("codex_acp")).toEqual([]);
});

it("does not lease tools or start processes for a cancelled queued start", async () => {
  const world = toolWorld();
  const controller = new AbortController();
  controller.abort();
  await expect(
    prepareAgentToolSession({
      manager: world.manager,
      request: toolSessionInput(),
      signal: controller.signal,
    }),
  ).rejects.toBeInstanceOf(AgentPlanCancelledError);
  expect(world.install).not.toHaveBeenCalled();
});

it("checks saved active CLI sign-ins after startup without changing login metadata", async () => {
  const world = toolWorld();
  const connection = toolSessionInput().agent.connection;
  const login = structuredClone(connection);
  const check = vi.fn<AgentCliRuntime["check"]>(async () => ({
    ok: false,
    errorCode: "cli_not_logged_in",
    detail: {},
  }));
  const startup = new AgentToolStartupService({
    manager: world.manager,
    connections: { list: async () => [connection] },
    runtime: { check },
    resources: {
      snapshot: () => ({
        limitSource: "config",
        options: {
          maxConcurrentAcpSessions: 1,
          memoryAwareScheduling: true,
          minimumAvailableMemory: 0,
          acpIdleTimeout: 1000,
          queueDiscipline: "fifo",
        },
        availableMemory: 4096,
        problem: null,
        active: [],
        waiting: [],
      }),
    },
  });
  await startup.start();
  expect(check).toHaveBeenCalledWith(
    connection,
    "auth",
    expect.any(AbortSignal),
  );
  expect(connection).toEqual(login);
  expect(
    world.manager.list(TOOL_ADMIN).find((tool) => tool.id === "codex"),
  ).toMatchObject({ status: "authentication_required" });
});

it("returns promptly on abort while a shared tool installation finishes safely in the background", async () => {
  const world = toolWorld();
  let resume: () => void = () => undefined;
  const installed = new Promise<void>((resolve) => {
    resume = resolve;
  });
  world.install.mockImplementationOnce(async () => installed);
  const controller = new AbortController();
  const waiting = prepareAgentToolSession({
    manager: world.manager,
    request: toolSessionInput(),
    signal: controller.signal,
  });
  await vi.waitFor(() => expect(world.install).toHaveBeenCalled());
  controller.abort();
  await expect(waiting).rejects.toBeInstanceOf(AgentPlanCancelledError);
  resume();
  await vi.waitFor(() =>
    expect(world.manager.supervisor.activities("codex")).toEqual([]),
  );
});

it("rechecks the pinned approved adapter version in the actual ACP handshake", async () => {
  const { execution, fake } = toolRuntimeWorld({
    agentInfo: { name: "@agentclientprotocol/codex-acp", version: "2.1.1" },
  });
  const session = await execution.open(
    toolSessionInput(),
    new AbortController().signal,
    { started: () => undefined, identified: () => undefined },
  );
  expect((await session.turn).errorCode).toBe("plan_acp_adapter_unsupported");
  expect(fake.calls.map((call) => call.method)).not.toContain("session/prompt");
  expect((await session.close()).isConfirmed).toBe(true);
});

it("refuses a managed read-only session if the namespace probe fails after readiness, even without the legacy required setting", async () => {
  const { execution, fake, world } = toolRuntimeWorld({}, async () => false);
  await expect(
    execution.open(toolSessionInput(), new AbortController().signal, {
      started: () => undefined,
      identified: () => undefined,
    }),
  ).rejects.toMatchObject({ code: "cli_isolation_unavailable" });
  expect(fake.spawned).toEqual([]);
  expect(world.manager.supervisor.activities("codex")).toEqual([]);
});
