import { beforeEach, expect, it, vi } from "vitest";

import { handleAgentsAction } from "@/app/lib/settings-actions/settings-agents-actions.server";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { outcomeOf, settingsContext, thrownStatus } from "./action-fixtures";

import type { AccountAccess } from "@/definition/Authorization";
import type { ActionOutcome, FormFields } from "./action-fixtures";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
  logEvent: vi.fn(),
}));

const ACCOUNT: AccountAccess = {
  userId: "actor",
  role: null,
  isActive: true,
  isAdmin: true,
  mode: "admin",
  firstName: "Actor",
  lastName: "",
  departments: [],
  managedDepartments: [],
  allDepartments: true,
  allProjects: true,
  hasHadDepartment: false,
};

const services = {
  administrationService: { getContext: vi.fn(), setMode: vi.fn() },
  agentConnectionService: {
    setActive: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  openCodeProviderLinks: {
    afterKeyChange: vi.fn(),
    activate: vi.fn(),
    isLinkCandidate: vi.fn(),
    refresh: vi.fn(),
  },
  picaSettingsService: { save: vi.fn() },
  agentCatalogService: { configure: vi.fn(), run: vi.fn() },
  agentCheckService: { run: vi.fn() },
  agentCliLoginService: {
    start: vi.fn(),
    submitCode: vi.fn(),
    cancel: vi.fn(),
    logout: vi.fn(),
    storeKey: vi.fn(),
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  services.administrationService.getContext.mockResolvedValue(ACCOUNT);
});

async function run(fields: FormFields): Promise<ActionOutcome> {
  return outcomeOf(await handleAgentsAction(settingsContext(services, fields)));
}

async function agentErrorCode(fields: FormFields): Promise<string> {
  try {
    await handleAgentsAction(settingsContext(services, fields));
  } catch (error: unknown) {
    if (error instanceof AgentError) return error.code;
    throw error;
  }
  throw new Error("Expected an agent error.");
}

it("switches the mode without requiring the administrator mode", async () => {
  const outcome = await run({ intent: "set-mode", mode: "role" });

  expect(services.administrationService.setMode).toHaveBeenCalledWith(
    "actor",
    "role",
  );
  expect(services.administrationService.getContext).not.toHaveBeenCalled();
  expect(outcome.status).toBe(200);
  expect(outcome.body).toEqual({ intent: "set-mode", ok: true });
  expect(outcome.headers.get("Cache-Control")).toBe("no-store");
});

it("refuses a missing or unknown intent after checking the account", async () => {
  for (const intent of [undefined, "unknown", "toString"]) {
    const fields: FormFields = intent === undefined ? {} : { intent };
    const status = await thrownStatus(
      handleAgentsAction(settingsContext(services, fields)),
    );

    expect(status).toBe(400);
  }
  expect(services.administrationService.getContext).toHaveBeenCalledTimes(3);
});

it("requires a connection for connection intents", async () => {
  await expect(agentErrorCode({ intent: "refresh-catalog" })).resolves.toBe(
    "connection_not_found",
  );
  expect(services.agentCatalogService.run).not.toHaveBeenCalled();
});

it("answers retired profile intents with a stable refusal", async () => {
  for (const intent of [
    "save-profile",
    "delete-profile",
    "profile-usages",
    "delete-assignment",
  ]) {
    await expect(agentErrorCode({ intent })).resolves.toBe(
      "profile_management_retired",
    );
  }
});

it("activates and deactivates a connection and refreshes its OpenCode links", async () => {
  for (const isActive of ["true", "false"]) {
    const outcome = await run({
      intent: "set-connection-active",
      connectionId: "c1",
      isActive,
    });

    expect(outcome.body).toEqual({
      ok: true,
      connectionId: "c1",
      intent: "set-connection-active",
    });
  }
  expect(services.agentConnectionService.setActive.mock.calls).toEqual([
    [ACCOUNT, "c1", true],
    [ACCOUNT, "c1", false],
  ]);
  expect(services.openCodeProviderLinks.afterKeyChange).toHaveBeenCalledWith(
    ACCOUNT,
    "c1",
  );
  expect(services.openCodeProviderLinks.activate).toHaveBeenCalledWith(
    ACCOUNT,
    "c1",
  );
});

it("refuses an unreadable active state", async () => {
  await expect(
    agentErrorCode({
      intent: "set-connection-active",
      connectionId: "c1",
      isActive: "yes",
    }),
  ).resolves.toBe("profile_invalid");
  expect(services.agentConnectionService.setActive).not.toHaveBeenCalled();
});

const PICA: FormFields = {
  intent: "save-pica",
  isEnabled: "true",
  modelConnectionId: "c1",
  model: "model-a",
  reasoningEffort: "high",
  revision: "3",
};

it("stores Pica's model choice with its reasoning level", async () => {
  const outcome = await run(PICA);

  expect(services.picaSettingsService.save).toHaveBeenCalledWith("actor", {
    isEnabled: true,
    selection: {
      connectionId: "c1",
      model: "model-a",
      reasoningEffort: "high",
    },
    revision: 3,
  });
  expect(outcome.body).toEqual({ ok: true, intent: "save-pica" });
});

it("stores Pica without a level or without a complete model choice", async () => {
  await run({ ...PICA, reasoningEffort: "" });
  await run({ ...PICA, isEnabled: "false", model: "" });

  expect(services.picaSettingsService.save.mock.calls).toEqual([
    [
      "actor",
      {
        isEnabled: true,
        selection: {
          connectionId: "c1",
          model: "model-a",
          reasoningEffort: null,
        },
        revision: 3,
      },
    ],
    ["actor", { isEnabled: false, selection: null, revision: 3 }],
  ]);
});

it("refuses malformed or oversized Pica settings", async () => {
  const invalid: FormFields[] = [
    { ...PICA, isEnabled: "maybe" },
    { ...PICA, modelConnectionId: "c".repeat(101) },
    { ...PICA, model: "m".repeat(501) },
    { ...PICA, reasoningEffort: "e".repeat(101) },
    { ...PICA, revision: "1.5" },
  ];

  for (const fields of invalid) {
    await expect(agentErrorCode(fields)).resolves.toBe("profile_invalid");
  }
  expect(services.picaSettingsService.save).not.toHaveBeenCalled();
});

const CONNECTION: FormFields = {
  intent: "create-connection",
  name: "OpenCode",
  provider: "opencode",
  apiKey: "",
  testModel: "",
  reasoningEffort: "",
};

it("creates a connection with a scope and signs it in at once", async () => {
  services.agentConnectionService.create.mockResolvedValue("new");

  const outcome = await run({ ...CONNECTION, scope: '{"global":true}' });

  expect(services.agentConnectionService.create).toHaveBeenCalledWith(ACCOUNT, {
    name: "OpenCode",
    provider: "opencode",
    zaiAccountType: undefined,
    apiKey: "",
    testModel: "",
    reasoningEffort: "",
    scope: { global: true },
  });
  expect(services.openCodeProviderLinks.afterKeyChange).toHaveBeenCalledWith(
    ACCOUNT,
    "new",
  );
  expect(services.openCodeProviderLinks.activate).toHaveBeenCalledWith(
    ACCOUNT,
    "new",
  );
  expect(outcome.body).toEqual({
    ok: true,
    connectionId: "new",
    intent: "create-connection",
  });
});

it("leaves an absent scope and absent optional fields unset", async () => {
  await run({ intent: "create-connection" });

  expect(services.agentConnectionService.create).toHaveBeenCalledWith(ACCOUNT, {
    name: "",
    provider: undefined,
    zaiAccountType: undefined,
    apiKey: "",
    testModel: "",
    reasoningEffort: "",
    scope: undefined,
  });
});

it("refuses an oversized or unreadable scope without echoing it", async () => {
  await expect(
    agentErrorCode({ ...CONNECTION, scope: `"${"x".repeat(50_000)}"` }),
  ).resolves.toBe("connection_scope_invalid");
  expect(logCaughtError).not.toHaveBeenCalled();

  await expect(
    agentErrorCode({ ...CONNECTION, scope: "{secret" }),
  ).resolves.toBe("connection_scope_invalid");
  expect(logCaughtError).toHaveBeenCalledWith(
    "settings_agents_actions",
    expect.any(SyntaxError),
  );
  expect(services.agentConnectionService.create).not.toHaveBeenCalled();
});

it("rechecks linked access only when an update brings a new key", async () => {
  await run({
    ...CONNECTION,
    intent: "update-connection",
    connectionId: "c1",
    apiKey: "sk-new",
  });
  await run({ ...CONNECTION, intent: "update-connection", connectionId: "c2" });

  expect(services.agentConnectionService.update).toHaveBeenCalledTimes(2);
  expect(services.openCodeProviderLinks.afterKeyChange.mock.calls).toEqual([
    [ACCOUNT, "c1"],
  ]);
});

it("refreshes OpenCode links only after deleting a linked connection", async () => {
  services.openCodeProviderLinks.isLinkCandidate
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);

  const linked = await run({ intent: "delete-connection", connectionId: "c1" });
  await run({ intent: "delete-connection", connectionId: "c2" });

  expect(services.agentConnectionService.remove.mock.calls).toEqual([
    [ACCOUNT, "c1"],
    [ACCOUNT, "c2"],
  ]);
  expect(services.openCodeProviderLinks.refresh).toHaveBeenCalledOnce();
  expect(linked.body).toEqual({
    ok: true,
    connectionId: "c1",
    intent: "delete-connection",
  });
});

it("configures the catalog interval and reads an absent interval as invalid", async () => {
  await run({
    intent: "configure-catalog",
    connectionId: "c1",
    intervalHours: "12",
  });
  await run({ intent: "configure-catalog", connectionId: "c1" });

  expect(services.agentCatalogService.configure.mock.calls).toEqual([
    [ACCOUNT, "c1", 12],
    [ACCOUNT, "c1", Number.NaN],
  ]);
});

it("refreshes the catalog of a connection", async () => {
  const outcome = await run({ intent: "refresh-catalog", connectionId: "c1" });

  expect(services.agentCatalogService.run).toHaveBeenCalledWith(ACCOUNT, "c1");
  expect(outcome.body).toEqual({
    ok: true,
    connectionId: "c1",
    intent: "refresh-catalog",
  });
});

it("runs an access check and refreshes OpenCode links of a linked connection", async () => {
  services.agentCheckService.run.mockResolvedValue({ status: "ok" });
  services.openCodeProviderLinks.isLinkCandidate
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);

  const outcome = await run({
    intent: "run-check",
    connectionId: "c1",
    kind: "auth",
  });
  await run({ intent: "run-check", connectionId: "c2", kind: "auth" });

  expect(outcome.body).toEqual({
    ok: true,
    check: { status: "ok" },
    intent: "run-check",
  });
  expect(services.openCodeProviderLinks.refresh).toHaveBeenCalledOnce();
});

it("runs a model check without touching OpenCode links", async () => {
  await run({ intent: "run-check", connectionId: "c1", kind: "model" });

  expect(services.agentCheckService.run).toHaveBeenCalledWith(
    ACCOUNT,
    "c1",
    "model",
  );
  expect(services.openCodeProviderLinks.isLinkCandidate).not.toHaveBeenCalled();
});

it("refuses an unknown check kind", async () => {
  const status = await thrownStatus(
    handleAgentsAction(
      settingsContext(services, {
        intent: "run-check",
        connectionId: "c1",
        kind: "network",
      }),
    ),
  );

  expect(status).toBe(400);
  expect(services.agentCheckService.run).not.toHaveBeenCalled();
});

it("starts a CLI sign-in and answers its view", async () => {
  services.agentCliLoginService.start.mockResolvedValue({ state: "waiting" });

  const outcome = await run({ intent: "start-login", connectionId: "c1" });

  expect(services.agentCliLoginService.start).toHaveBeenCalledWith(
    ACCOUNT,
    "c1",
  );
  expect(outcome.body).toEqual({
    ok: true,
    login: { state: "waiting" },
    intent: "start-login",
  });
});

it("submits and cancels a sign-in code", async () => {
  await run({ intent: "submit-login-code", connectionId: "c1", code: "1234" });
  await run({ intent: "submit-login-code", connectionId: "c1" });
  const cancelled = await run({ intent: "cancel-login", connectionId: "c1" });

  expect(services.agentCliLoginService.submitCode.mock.calls).toEqual([
    [ACCOUNT, "c1", "1234"],
    [ACCOUNT, "c1", ""],
  ]);
  expect(services.agentCliLoginService.cancel).toHaveBeenCalledWith(
    ACCOUNT,
    "c1",
  );
  expect(cancelled.body).toEqual({ ok: true, intent: "cancel-login" });
});

it("signs out of the CLI and keeps the linked OpenCode providers", async () => {
  const outcome = await run({ intent: "logout-cli", connectionId: "c1" });

  expect(services.agentCliLoginService.logout).toHaveBeenCalledWith(
    ACCOUNT,
    "c1",
  );
  expect(services.openCodeProviderLinks.activate).toHaveBeenCalledWith(
    ACCOUNT,
    "c1",
  );
  expect(outcome.body).toEqual({ ok: true, intent: "logout-cli" });
});

it("stores a CLI key for its model provider", async () => {
  const outcome = await run({
    intent: "store-cli-key",
    connectionId: "c1",
    apiKey: "sk-key",
    modelProvider: "anthropic",
  });
  await run({ intent: "store-cli-key", connectionId: "c2" });

  expect(services.agentCliLoginService.storeKey.mock.calls).toEqual([
    [ACCOUNT, "c1", { apiKey: "sk-key", modelProvider: "anthropic" }],
    [ACCOUNT, "c2", { apiKey: "", modelProvider: "" }],
  ]);
  expect(outcome.body).toEqual({
    ok: true,
    connectionId: "c1",
    intent: "store-cli-key",
  });
});
