import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import { CliLocator } from "@/backend/agents/cli/CliLocator";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { CliPlanExecution } from "@/backend/agents/cli/CliPlanExecution";
import { cliPlanArguments } from "@/backend/agents/cli/CliPlanArguments";
import { readCliPlanResponse } from "@/backend/agents/cli/CliPlanResponse";
import { AgentPlanExecution } from "@/backend/agents/AgentPlanExecution";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { sanitizePlanOutput } from "@/backend/service/agents/AgentPlanOutput";

import { CLI_HOME, completeCli, createCliSpawn } from "../helpers/agent-cli";

import type { CliToolAdapter } from "@/backend/agents/cli/CliContracts";
import type { TextExecution } from "@/backend/agents/TextExecution";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { CliProviderId } from "@/definition/AgentConnection";

let directory = "";
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pages-plan-cli-"));
  await mkdir(path.join(directory, "copy"));
  await mkdir(path.join(directory, "credentials"));
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(directory, { force: true, recursive: true });
});

function setup(provider: CliProviderId = "codex_cli") {
  const store = new AgentCredentialStore(path.join(directory, "credentials"));
  const locator = new CliLocator("/synthetic/not-installed", "/synthetic/node");
  vi.spyOn(locator, "find").mockResolvedValue({
    found: true,
    path: "/synthetic/binary",
  });
  const fake = createCliSpawn();
  const runner = new CliProcessRunner(fake);
  const runtime = new AgentCliRuntime({ store, locator, runner });
  const adapter: CliToolAdapter = {
    provider,
    readStatus: vi.fn().mockResolvedValue({
      outcome: { ok: true, detail: {} },
      accountLabel: null,
    }),
    version: vi.fn(),
    startLogin: vi.fn(),
    loginError: vi.fn(),
    runTest: vi.fn(),
    listModels: vi.fn(),
    logout: vi.fn(),
  };
  vi.spyOn(runtime, "adapter").mockResolvedValue(adapter);
  const input: AgentPlanExecutionInput = {
    userId: "person",
    prompt: "Edit the selected task",
    directory: path.join(directory, "copy"),
    beforeStart: vi.fn(async () => undefined),
    agent: {
      model: "listed-model",
      reasoningEffort: "medium",
      connection: {
        isActive: true,
        id: path.basename(CLI_HOME.root),
        name: "CLI",
        provider,
        hasApiKey: false,
        testModel: "diagnostic-default",
        reasoningEffort: null,
        cliLoggedInAt: "now",
        cliAccountLabel: null,
        updatedAt: "now",
      },
    },
  };
  return {
    store,
    locator,
    runner,
    fake,
    input,
    adapter,
    execution: new CliPlanExecution({ store, locator, runner, runtime }),
  };
}

const CODEX_FINAL = [
  {
    type: "item.completed",
    item: {
      type: "command_execution",
      aggregated_output: "synthetic-private-tool-log",
    },
  },
  { type: "item.completed", item: { type: "agent_message", text: "Finished" } },
  { type: "turn.completed" },
]
  .map((entry) => JSON.stringify(entry))
  .join("\n");

describe("A10.4 real CLI adapter contracts with injected child processes", () => {
  it("rejects expired login, missing executables and cancellation during both preflight phases", async () => {
    const current = setup();
    const controller = new AbortController();
    vi.mocked(current.adapter.readStatus).mockResolvedValueOnce({
      outcome: { ok: false, errorCode: "cli_auth_failed", detail: {} },
      accountLabel: null,
    });
    await expect(
      current.execution.run(current.input, controller.signal),
    ).rejects.toMatchObject({ code: "plan_step_failed" });
    vi.mocked(current.locator.find).mockResolvedValueOnce({
      found: false,
      path: null,
    });
    await expect(
      current.execution.run(current.input, controller.signal),
    ).rejects.toMatchObject({ code: "cli_not_executable" });
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      current.execution.run(current.input, aborted.signal),
    ).rejects.toThrow("cancellation confirmed");
    await expect(
      current.execution.run(
        { ...current.input, beforeStart: async () => controller.abort() },
        controller.signal,
      ),
    ).rejects.toThrow("cancellation confirmed");
    expect(current.fake.spawn).not.toHaveBeenCalled();
  });

  it("translates runner failure and timeout while refusing API connections at the CLI boundary", async () => {
    const current = setup();
    vi.spyOn(current.runner, "run").mockResolvedValue({
      stdout: "",
      stderr: "synthetic private output",
      exitCode: 1,
      errorCode: null,
    });
    await expect(
      current.execution.run(current.input, new AbortController().signal),
    ).rejects.toMatchObject({ code: "plan_step_failed" });
    // The time limit has a code of its own, so a run record can name it.
    vi.mocked(current.runner.run).mockResolvedValueOnce({
      stdout: "",
      stderr: "synthetic private output",
      exitCode: null,
      errorCode: "check_timeout",
    });
    await expect(
      current.execution.run(current.input, new AbortController().signal),
    ).rejects.toMatchObject({ code: "timeout" });
    const controller = new AbortController();
    vi.mocked(current.runner.run).mockImplementationOnce(async () => {
      controller.abort();
      return {
        stdout: "",
        stderr: "",
        exitCode: null,
        errorCode: "check_timeout",
      };
    });
    await expect(
      current.execution.run(current.input, controller.signal),
    ).rejects.toThrow("cancellation confirmed");
    const cancelled = new AbortController();
    vi.mocked(current.runner.run).mockImplementationOnce(async () => {
      cancelled.abort();
      return {
        stdout: "",
        stderr: "",
        exitCode: null,
        errorCode: "login_cancelled",
      };
    });
    await expect(
      current.execution.run(current.input, cancelled.signal),
    ).rejects.toThrow("cancellation confirmed");
    await expect(
      current.execution.run(
        {
          ...current.input,
          agent: {
            ...current.input.agent,
            connection: {
              ...current.input.agent.connection,
              provider: "openrouter",
            },
          },
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "plan_directory_required" });
    const withoutEffort = {
      ...current.input,
      directory: null,
      agent: { ...current.input.agent, reasoningEffort: null },
    };
    expect(cliPlanArguments("claude_code", withoutEffort)).not.toContain(
      "--effort",
    );
    expect(cliPlanArguments("codex_cli", withoutEffort)).toContain("");
    expect(cliPlanArguments("codex_cli", withoutEffort)).not.toContain(
      'model_reasoning_effort="medium"',
    );
  });

  it("delegates pinned CLI execution and distinguishes caller abort, timeout and provider failure for API work", async () => {
    const current = setup();
    const operations = new AgentOperationRegistry();
    const api = { run: vi.fn<TextExecution["run"]>() };
    const cli = { run: vi.fn().mockResolvedValue("CLI final") };
    const execution = new AgentPlanExecution(api, cli, operations);
    expect(
      await execution.run(current.input, new AbortController().signal),
    ).toBe("CLI final");
    expect(cli.run).toHaveBeenCalledWith(
      current.input,
      expect.any(AbortSignal),
    );
    const apiInput = {
      ...current.input,
      beforeStart: undefined,
      agent: {
        ...current.input.agent,
        connection: {
          ...current.input.agent.connection,
          provider: "openrouter" as const,
        },
      },
    };
    const failure = new Error("provider failed");
    api.run.mockRejectedValue(failure);
    await expect(
      execution.run(apiInput, new AbortController().signal),
    ).rejects.toBe(failure);
    const caller = new AbortController();
    api.run.mockImplementationOnce(async () => {
      caller.abort();
      throw failure;
    });
    await expect(execution.run(apiInput, caller.signal)).rejects.toThrow(
      "cancellation confirmed",
    );
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(timeout.signal);
    api.run.mockImplementationOnce(async () => {
      timeout.abort();
      throw failure;
    });
    await expect(
      execution.run(apiInput, new AbortController().signal),
    ).rejects.toMatchObject({ code: "timeout" });
    const release = operations.acquire(
      current.input.agent.connection.id,
      "write",
    );
    release();
  });

  it("prevents execution during login or checks and makes release idempotent", () => {
    const operations = new AgentOperationRegistry();
    for (const kind of ["login", "check"] as const) {
      const release = operations.acquire("access", kind);
      expect(() => operations.acquireExecution("access")).toThrow(
        expect.objectContaining({
          code: kind === "login" ? "login_in_progress" : "check_in_progress",
        }),
      );
      release();
    }
    const first = operations.acquireExecution("access");
    const second = operations.acquireExecution("access");
    first();
    first();
    expect(() => operations.acquire("access", "write")).toThrow();
    second();
    operations.acquire("access", "write")();
    const release = operations.acquireExecution("lost-counter");
    const counters: unknown = Reflect.get(operations, "executions");
    if (!(counters instanceof Map))
      throw new Error("Missing execution counter map");
    counters.delete("lost-counter");
    expect(release).not.toThrow();
    operations.acquire("lost-counter", "write")();
  });

  it.each(["codex_cli", "claude_code"] as const)(
    "runs %s in the explicit working copy while keeping isolated credential HOME and pinned model",
    async (provider) => {
      const current = setup(provider);
      const pending = current.execution.run(
        current.input,
        new AbortController().signal,
      );
      await vi.waitFor(() => expect(current.fake.children).toHaveLength(1));
      const [, arguments_, options] = current.fake.spawn.mock.calls[0];
      expect(options.cwd).toBe(current.input.directory);
      expect(options.env?.HOME).toContain(path.join(directory, "credentials"));
      expect(options.env?.HOME).not.toBe(current.input.directory);
      expect(options).toMatchObject({ shell: false, detached: true });
      expect(arguments_).toContain("listed-model");
      expect(arguments_).not.toContain("diagnostic-default");
      expect(arguments_).not.toContain(current.input.prompt);
      if (provider === "codex_cli") {
        expect(arguments_).toContain("workspace-write");
        expect(arguments_).toContain(current.input.directory);
        expect(arguments_).toContain("mcp_servers={}");
      } else {
        expect(arguments_).toContain("Read,Edit,Write,Glob,Grep");
        expect(arguments_).toContain("--restricted");
        expect(arguments_).toContain("--safe-mode");
      }
      expect(current.input.beforeStart).toHaveBeenCalledOnce();
      completeCli(
        current.fake.children[0],
        provider === "codex_cli"
          ? CODEX_FINAL
          : JSON.stringify({
              is_error: false,
              subtype: "success",
              result: "Finished",
            }),
      );
      expect(await pending).toBe("Finished");
    },
  );

  it("does not infer cwd from a prompt path and refuses revoked access immediately before spawn", async () => {
    const current = setup();
    const signal = new AbortController().signal;
    await expect(
      current.execution.run(
        {
          ...current.input,
          directory: null,
          prompt: "Work in /forged/directory",
        },
        signal,
      ),
    ).rejects.toMatchObject({ code: "plan_directory_required" });
    await expect(
      current.execution.run(
        {
          ...current.input,
          beforeStart: async () => {
            throw new AgentError("plan_access_denied");
          },
        },
        signal,
      ),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
    expect(current.fake.spawn).not.toHaveBeenCalled();
  });

  it("reports confirmed cancellation only after the runner has drained its process group", async () => {
    const current = setup();
    const controller = new AbortController();
    const settled = vi.fn();
    const pending = current.execution
      .run(current.input, controller.signal)
      .then(settled, (error: unknown) => {
        settled(error);
        return error;
      });
    await vi.waitFor(() => expect(current.fake.children).toHaveLength(1));
    vi.useFakeTimers();
    controller.abort();
    expect(current.fake.signalGroup).toHaveBeenCalledWith(
      expect.any(Number),
      "SIGTERM",
    );
    expect(settled).not.toHaveBeenCalled();
    completeCli(current.fake.children[0], "", null);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toMatchObject({
      name: "Error",
      message: "Agent plan step cancellation confirmed.",
    });
    expect(current.fake.signalGroup).toHaveBeenCalledWith(
      expect.any(Number),
      "SIGKILL",
    );
  });

  it("accepts only completed final answers and redacts recognizable credentials before display/forwarding", () => {
    expect(readCliPlanResponse("codex_cli", CODEX_FINAL)).toBe("Finished");
    for (const output of [
      "not JSON",
      '{"type":"turn.failed","error":{"message":"synthetic-private"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"partial"}}',
    ])
      expect(() => readCliPlanResponse("codex_cli", output)).toThrow(
        expect.objectContaining({ code: "plan_step_failed" }),
      );
    const output = sanitizePlanOutput(
      'normal result api_key=synthetic-secret "refresh_token": "synthetic-refresh" Authorization: Bearer synthetic-auth sk-synthetic1234567890 github_pat_synthetic1234567890\n-----BEGIN PRIVATE KEY-----\nsynthetic-key\n-----END PRIVATE KEY-----',
    );
    expect(output).toContain("normal result");
    expect(output).not.toMatch(/synthetic/);
  });

  it("allows parallel API reads of one access and prevents mutations until both executions settle", async () => {
    const current = setup();
    const operations = new AgentOperationRegistry();
    const finishes: Array<(output: string) => void> = [];
    const api = {
      run: vi
        .fn<TextExecution["run"]>()
        .mockImplementation(
          async () => new Promise<string>((resolve) => finishes.push(resolve)),
        ),
    };
    const execution = new AgentPlanExecution(
      api,
      current.execution,
      operations,
    );
    const input: AgentPlanExecutionInput = {
      ...current.input,
      directory: null,
      agent: {
        ...current.input.agent,
        connection: {
          ...current.input.agent.connection,
          provider: "openrouter",
          hasApiKey: true,
        },
      },
    };
    const first = execution.run(input, new AbortController().signal);
    const second = execution.run(input, new AbortController().signal);
    await vi.waitFor(() => expect(finishes).toHaveLength(2));
    expect(() =>
      operations.acquire(input.agent.connection.id, "write"),
    ).toThrow();
    finishes[0]("First");
    expect(await first).toBe("First");
    expect(() =>
      operations.acquire(input.agent.connection.id, "login"),
    ).toThrow();
    finishes[1]("Second");
    expect(await second).toBe("Second");
    const release = operations.acquire(input.agent.connection.id, "write");
    release();
  });
});
