import { beforeEach, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { OpenCodeCli } from "@/backend/agents/cli/OpenCodeCli";
import { MODEL_TEST_PROMPT } from "@/definition/AgentConnection";
import { SUPPORTED_OPENCODE_VERSION } from "@/definition/OpenCodeVersion";

import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type {
  CliCredentialAccess,
  CliHome,
} from "@/backend/agents/cli/CliContracts";
import type { CliToolExecution } from "@/backend/agents/cli/CliToolExecution";

const h = vi.hoisted(() => ({
  requireConfiguration: vi.fn(),
  readModels: vi.fn(),
  readTest: vi.fn(),
  readOwn: vi.fn(),
  remove: vi.fn(),
  store: vi.fn(),
  credentials: vi.fn(),
  constructed: vi.fn(),
  logCaught: vi.fn(),
}));

vi.mock("@/backend/agents/acp/OpenCodeAcpConfiguration", () => ({
  requireManagedOpenCodeConfiguration: h.requireConfiguration,
}));
vi.mock("@/backend/agents/cli/CliModelCatalog", () => ({
  readOpenCodeModels: h.readModels,
}));
vi.mock("@/backend/agents/cli/CliResultParser", () => ({
  readOpenCodeTest: h.readTest,
}));
vi.mock("@/backend/agents/cli/OpenCodeCredentialStore", () => ({
  OpenCodeCredentialStore: class {
    public readOwn = h.readOwn;
    public remove = h.remove;
    public store = h.store;
    public constructor(cipher: unknown) {
      h.constructed(cipher);
    }
  },
  openCodeCredentials: h.credentials,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: h.logCaught,
  logEvent: vi.fn(),
}));

const HOME: CliHome = { root: "/r", home: "/h", config: "/c", work: "/w" };
const SIGNAL = new AbortController().signal;

/** Casts a partial stand-in to the type the code under test expects. */
function fake<T>(value: object): T {
  return value as T;
}

const execution = {
  version: vi.fn(),
  prompt: vi.fn(),
  readCatalog: vi.fn(),
};
const access = {
  modelProviders: ["opencode", "google"],
  ownProvider: "google",
  environmentFor: vi.fn((provider: string) => ({ KEY: provider })),
  redact: vi.fn((text: string) => `redacted:${text}`),
};

function cli(cipher?: InstanceSecretCipher): OpenCodeCli {
  return new OpenCodeCli(fake<CliToolExecution>(execution), cipher);
}

beforeEach(() => {
  h.readOwn.mockResolvedValue(null);
  h.credentials.mockReturnValue(fake<CliCredentialAccess>(access));
  access.environmentFor.mockImplementation((provider: string) => ({
    KEY: provider,
  }));
  access.redact.mockImplementation((text: string) => `redacted:${text}`);
});

it("passes the cipher to its credential store", () => {
  const cipher = fake<InstanceSecretCipher>({});
  expect(cli(cipher).provider).toBe("opencode");
  expect(h.constructed).toHaveBeenCalledWith(cipher);
});

it("reports the own provider of a connection as its account", async () => {
  const status = await cli().readStatus(HOME, SIGNAL);
  expect(status).toEqual({
    outcome: { ok: true, detail: { modelProvider: "google" } },
    accountLabel: "google",
    credentials: access,
  });
});

it("reports a connection without an own key as logged in", async () => {
  h.credentials.mockReturnValue({ ...access, ownProvider: null });
  const status = await cli().readStatus(HOME, SIGNAL);
  expect(status.outcome).toEqual({ ok: true, detail: {} });
  expect(status.accountLabel).toBeNull();
});

it("reports the error code of a failing status read", async () => {
  h.readOwn.mockRejectedValueOnce(new AgentError("secret_unavailable"));
  expect((await cli().readStatus(HOME, SIGNAL)).outcome).toEqual({
    ok: false,
    errorCode: "secret_unavailable",
    detail: {},
  });
  h.readOwn.mockRejectedValueOnce(new Error("other"));
  expect(await cli().readStatus(HOME, SIGNAL)).toEqual({
    outcome: { ok: false, errorCode: "cli_not_logged_in", detail: {} },
    accountLabel: null,
  });
});

it("stops a status read of an aborted request", async () => {
  const controller = new AbortController();
  controller.abort(new Error("aborted"));
  await expect(cli().readStatus(HOME, controller.signal)).rejects.toThrow(
    "aborted",
  );
});

it("rejects an unsupported or unreadable version", async () => {
  execution.version.mockResolvedValueOnce({
    ok: true,
    detail: { cliVersion: "0.1.0" },
  });
  expect(await cli().version(HOME, SIGNAL)).toEqual({
    ok: false,
    errorCode: "opencode_acp_unsupported",
    detail: { cliVersion: "0.1.0" },
  });
  execution.version.mockResolvedValueOnce({ ok: true, detail: {} });
  expect(await cli().version(HOME, SIGNAL)).toMatchObject({
    ok: false,
    errorCode: "opencode_acp_unsupported",
  });
  const failure = { ok: false, errorCode: "cli_unexpected_output", detail: {} };
  execution.version.mockResolvedValueOnce(failure);
  expect(await cli().version(HOME, SIGNAL)).toBe(failure);
});

it("accepts a supported version", async () => {
  const supported = {
    ok: true,
    detail: { cliVersion: SUPPORTED_OPENCODE_VERSION },
  };
  execution.version.mockResolvedValueOnce(supported);
  expect(await cli().version(HOME, SIGNAL)).toBe(supported);
});

it("stores a key through the credential store", async () => {
  const input = { modelProvider: "google", apiKey: "k" };
  await cli().storeKey(HOME, input);
  expect(h.store).toHaveBeenCalledWith(HOME, input);
});

it("requires a model for a test", async () => {
  expect(
    await cli().runTest(HOME, { model: null, reasoningEffort: null }, SIGNAL),
  ).toEqual({ ok: false, errorCode: "test_model_required", detail: {} });
});

it("refuses a retired or unreachable model", async () => {
  for (const model of ["zai/model", "other/model"]) {
    expect(
      await cli().runTest(HOME, { model, reasoningEffort: null }, SIGNAL),
    ).toEqual({ ok: false, errorCode: "plan_model_unavailable", detail: {} });
  }
  expect(execution.prompt).not.toHaveBeenCalled();
});

it("runs one tool-free turn with the key of the model's provider", async () => {
  execution.prompt.mockResolvedValue({ stdout: "out" });
  h.readTest.mockReturnValue({ ok: true, detail: {} });
  const result = await cli().runTest(
    HOME,
    { model: "google/flash", reasoningEffort: "high" },
    SIGNAL,
  );
  expect(h.requireConfiguration).toHaveBeenCalledWith(HOME);
  expect(execution.prompt).toHaveBeenCalledWith(
    HOME,
    {
      arguments: [
        "run",
        "--format",
        "json",
        "--pure",
        "-m",
        "google/flash",
        "--variant",
        "high",
      ],
      input: MODEL_TEST_PROMPT,
      environment: {
        KEY: "google",
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          permission: "deny",
          share: "disabled",
          autoupdate: false,
        }),
      },
    },
    SIGNAL,
  );
  expect(h.readTest).toHaveBeenCalledWith("redacted:out");
  expect(result).toEqual({ ok: true, detail: {} });
});

it("omits the variant without a reasoning effort and reports a process error", async () => {
  execution.prompt.mockResolvedValue({
    errorCode: "cli_not_logged_in",
    stdout: "",
  });
  expect(
    await cli().runTest(
      HOME,
      { model: "opencode/free", reasoningEffort: null },
      SIGNAL,
    ),
  ).toEqual({ ok: false, errorCode: "cli_not_logged_in", detail: {} });
  expect(execution.prompt.mock.calls[0][1].arguments).not.toContain(
    "--variant",
  );
});

it("lists only the free models of the free provider", async () => {
  execution.version.mockResolvedValue({
    ok: true,
    detail: { cliVersion: SUPPORTED_OPENCODE_VERSION },
  });
  execution.readCatalog.mockResolvedValue({ exitCode: 0, stdout: "list" });
  h.readModels.mockReturnValue([
    { id: "opencode/a", isFree: true },
    { id: "opencode/b", isFree: false },
  ]);
  expect(await cli().listModels(HOME, SIGNAL)).toEqual([
    { id: "opencode/a", isFree: true },
  ]);
  expect(h.requireConfiguration).toHaveBeenCalledWith(HOME);
  expect(execution.readCatalog).toHaveBeenCalledWith(
    HOME,
    ["models", "opencode", "--verbose"],
    SIGNAL,
    {
      environment: {
        KEY: "opencode",
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          enabled_providers: ["opencode"],
          share: "disabled",
          autoupdate: false,
        }),
      },
    },
  );
  expect(h.readModels).toHaveBeenCalledWith("redacted:list");
});

it("fails the model list on an unsupported version", async () => {
  execution.version.mockResolvedValue({
    ok: false,
    errorCode: "cli_unexpected_output",
    detail: {},
  });
  await expect(cli().listModels(HOME, SIGNAL)).rejects.toEqual(
    new AgentError("cli_unexpected_output"),
  );
});

it("fails the model list on a process error, exit code or foreign model", async () => {
  execution.version.mockResolvedValue({
    ok: true,
    detail: { cliVersion: SUPPORTED_OPENCODE_VERSION },
  });
  execution.readCatalog.mockResolvedValueOnce({
    errorCode: "cli_not_logged_in",
  });
  await expect(cli().listModels(HOME, SIGNAL)).rejects.toEqual(
    new AgentError("cli_not_logged_in"),
  );
  execution.readCatalog.mockResolvedValueOnce({ exitCode: 1, stdout: "" });
  await expect(cli().listModels(HOME, SIGNAL)).rejects.toEqual(
    new AgentError("cli_unexpected_output"),
  );
  execution.readCatalog.mockResolvedValueOnce({ exitCode: 0, stdout: "" });
  h.readModels.mockReturnValueOnce([{ id: "google/a", isFree: true }]);
  await expect(cli().listModels(HOME, SIGNAL)).rejects.toEqual(
    new AgentError("cli_unexpected_output"),
  );
});

it("removes the stored key on logout and reports a failure", async () => {
  expect(await cli().logout(HOME)).toEqual({ ok: true, detail: {} });
  h.remove.mockRejectedValueOnce(new Error("rm"));
  expect(await cli().logout(HOME)).toEqual({
    ok: false,
    errorCode: "credential_cleanup_failed",
    detail: {},
  });
  expect(h.logCaught).toHaveBeenCalledOnce();
});
