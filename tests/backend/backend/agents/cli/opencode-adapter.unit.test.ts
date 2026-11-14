import { beforeEach, expect, it, vi } from "vitest";

import { OpenCodeCli } from "@/backend/agents/cli/OpenCodeCli";
import { OpenCodeCredentialStore } from "@/backend/agents/cli/OpenCodeCredentialStore";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { CliToolExecution } from "@/backend/agents/cli/CliToolExecution";
import { AgentError } from "@/backend/error/AgentErrors";
import { SUPPORTED_OPENCODE_VERSION } from "@/definition/OpenCodeVersion";

import type { CliHome } from "@/backend/agents/cli/CliContracts";

vi.mock("@/backend/agents/acp/OpenCodeAcpConfiguration", () => ({
  requireManagedOpenCodeConfiguration: vi.fn(async () => {}),
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const HOME: CliHome = {
  root: "/synthetic",
  home: "/synthetic/home",
  config: "/synthetic/config",
  work: "/synthetic/work",
};
const SIGNAL = new AbortController().signal;

function setup(): { adapter: OpenCodeCli; execution: CliToolExecution } {
  const execution = new CliToolExecution(
    new CliProcessRunner(),
    "/synthetic/opencode",
    "opencode",
  );
  return {
    adapter: new OpenCodeCli(execution, undefined, {
      read: async () => [{ modelProvider: "openrouter", apiKey: "secret" }],
    }),
    execution,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(OpenCodeCredentialStore.prototype, "readOwn").mockResolvedValue(
    null,
  );
});

it("reports reachable credentials and maps credential failures", async () => {
  const { adapter } = setup();
  const status = await adapter.readStatus(HOME, SIGNAL);
  expect(status.outcome).toEqual({ ok: true, detail: {} });
  expect(status.credentials?.modelProviders).toContain("openrouter");
  vi.spyOn(OpenCodeCredentialStore.prototype, "readOwn").mockRejectedValue(
    new AgentError("secret_unavailable"),
  );
  expect((await adapter.readStatus(HOME, SIGNAL)).outcome).toEqual({
    ok: false,
    errorCode: "secret_unavailable",
    detail: {},
  });
});

it("rejects unsupported versions while preserving process failures", async () => {
  const { adapter, execution } = setup();
  const version = vi
    .spyOn(execution, "version")
    .mockResolvedValue({ ok: true, detail: { cliVersion: "old" } });
  expect(await adapter.version(HOME, SIGNAL)).toEqual({
    ok: false,
    errorCode: "opencode_acp_unsupported",
    detail: { cliVersion: "old" },
  });
  version.mockResolvedValue({
    ok: false,
    errorCode: "cli_not_found",
    detail: {},
  });
  expect(await adapter.version(HOME, SIGNAL)).toEqual({
    ok: false,
    errorCode: "cli_not_found",
    detail: {},
  });
});

it("checks the selected provider before running a restricted prompt", async () => {
  const { adapter, execution } = setup();
  const prompt = vi.spyOn(execution, "prompt").mockResolvedValue({
    exitCode: 0,
    stdout: "",
    stderr: "",
    errorCode: "cli_check_failed",
  });
  expect(
    await adapter.runTest(HOME, { model: null, reasoningEffort: null }, SIGNAL),
  ).toMatchObject({ errorCode: "test_model_required" });
  expect(
    await adapter.runTest(
      HOME,
      { model: "unknown/model", reasoningEffort: null },
      SIGNAL,
    ),
  ).toMatchObject({ errorCode: "plan_model_unavailable" });
  expect(prompt).not.toHaveBeenCalled();
  expect(
    await adapter.runTest(
      HOME,
      { model: "openrouter/model", reasoningEffort: "high" },
      SIGNAL,
    ),
  ).toMatchObject({ errorCode: "cli_check_failed" });
  const request = prompt.mock.calls[0]?.[1];
  expect(request?.arguments).toEqual([
    "run",
    "--format",
    "json",
    "--pure",
    "-m",
    "openrouter/model",
    "--variant",
    "high",
  ]);
  expect(request?.environment?.OPENCODE_AUTH_CONTENT).toContain("secret");
});

it("lists free models and tolerates a linked provider failure", async () => {
  const { adapter, execution } = setup();
  vi.spyOn(execution, "version").mockResolvedValue({
    ok: true,
    detail: { cliVersion: SUPPORTED_OPENCODE_VERSION },
  });
  const catalog = vi
    .spyOn(execution, "readCatalog")
    .mockResolvedValueOnce({
      exitCode: 0,
      stdout: [
        `opencode/free\n${JSON.stringify({ id: "free", cost: { input: 0, output: 0 } }, null, 2)}`,
        `opencode/paid\n${JSON.stringify({ id: "paid", cost: { input: 1, output: 1 } }, null, 2)}`,
      ].join("\n"),
      stderr: "",
      errorCode: null,
    })
    .mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "",
      errorCode: null,
    });
  expect(
    (await adapter.listModels(HOME, SIGNAL)).map((model) => model.id),
  ).toEqual(["opencode/free"]);
  expect(catalog).toHaveBeenCalledTimes(2);
});

it("maps cleanup failures and stores keys through the credential store", async () => {
  const { adapter } = setup();
  const store = vi
    .spyOn(OpenCodeCredentialStore.prototype, "store")
    .mockResolvedValue();
  const remove = vi
    .spyOn(OpenCodeCredentialStore.prototype, "remove")
    .mockResolvedValue();
  const key = { modelProvider: "openrouter", apiKey: "secret" };
  await adapter.storeKey(HOME, key);
  expect(store).toHaveBeenCalledWith(HOME, key);
  expect(await adapter.logout(HOME)).toEqual({ ok: true, detail: {} });
  remove.mockRejectedValue(new Error("failure"));
  expect(await adapter.logout(HOME)).toEqual({
    ok: false,
    errorCode: "credential_cleanup_failed",
    detail: {},
  });
});
