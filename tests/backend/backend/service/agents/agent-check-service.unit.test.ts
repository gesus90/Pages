import { expect, it, vi } from "vitest";
import { AgentCheckService } from "@/backend/service/agents/AgentCheckService";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { PageAgentWorld } from "./page-agent-world";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { ProviderCheckOutcome } from "@/backend/agents/providers/ProviderContracts";
import type { AccountAccess } from "@/definition/Authorization";
import type { Mock } from "vitest";

interface CheckFixture {
  service: AgentCheckService;
  admin: AccountAccess;
  other: AccountAccess;
  repository: {
    findSecretEncrypted: Mock<() => Promise<string | null>>;
    setCliAccount: Mock<() => Promise<void>>;
  };
  save: Mock<() => Promise<void>>;
  adapter: {
    checkAccess: Mock<() => Promise<ProviderCheckOutcome>>;
    runModelTest: Mock<() => Promise<ProviderCheckOutcome>>;
  };
  cli: { check: Mock<() => Promise<ProviderCheckOutcome>> };
  catalog: { loadAfterAccess: Mock<() => Promise<void>> };
  timeout: Mock<() => AbortSignal>;
  cipher: { decrypt: Mock<() => string> };
}

const connection: AgentConnectionRecord = {
  id: "connection",
  name: "Example",
  provider: "zai",
  zaiAccountType: "coding-plan",
  isActive: true,
  hasApiKey: true,
  testModel: "model",
  reasoningEffort: "high",
  cliLoggedInAt: null,
  cliAccountLabel: null,
  updatedAt: "2026-01-01",
};

function setup(record: AgentConnectionRecord = connection): CheckFixture {
  const world = new PageAgentWorld();
  world.addPerson("admin", { isAdmin: true });
  world.addPerson("other");
  const [admin, other] = world.snapshot().accounts;
  const success: ProviderCheckOutcome = { ok: true, detail: {} };
  const save = vi.fn(async () => {});
  const repository = {
    find: vi.fn(async () => record),
    findSecretEncrypted: vi.fn(async (): Promise<string | null> => "encrypted"),
    setCliAccount: vi.fn(async () => {}),
    checks: () => ({ save }),
  };
  const adapter = {
    checkAccess: vi.fn(async (): Promise<ProviderCheckOutcome> => success),
    runModelTest: vi.fn(async (): Promise<ProviderCheckOutcome> => success),
  };
  const cli = {
    check: vi.fn(async (): Promise<ProviderCheckOutcome> => success),
  };
  const catalog = { loadAfterAccess: vi.fn(async () => {}) };
  const timeout = vi.fn(() => new AbortController().signal);
  const cipher = { decrypt: vi.fn(() => "synthetic-key") };
  const dependencies = {
    repository,
    cipher,
    cli,
    catalog,
    timeout,
    providers: { zai: adapter },
    operations: new AgentOperationRegistry(),
  };
  const service = new AgentCheckService(
    dependencies as unknown as ConstructorParameters<
      typeof AgentCheckService
    >[0],
  );
  return {
    service,
    admin,
    other,
    repository,
    save,
    adapter,
    cli,
    catalog,
    timeout,
    cipher,
  };
}

it("checks API access with the saved account type and persists the result before loading the catalog", async () => {
  const fixture = setup();
  const result = await fixture.service.run(fixture.admin, "connection", "auth");
  expect(fixture.timeout).toHaveBeenCalledWith(15000);
  expect(fixture.adapter.checkAccess).toHaveBeenCalledWith(
    "synthetic-key",
    expect.any(AbortSignal),
    "coding-plan",
  );
  expect(result).toMatchObject({
    status: "passed",
    errorCode: null,
    detail: {},
  });
  expect(fixture.save).toHaveBeenCalledWith(
    "connection",
    "auth",
    result,
    "admin",
  );
  expect(fixture.catalog.loadAfterAccess).toHaveBeenCalledWith("connection");
  expect(fixture.save.mock.invocationCallOrder[0]).toBeLessThan(
    fixture.catalog.loadAfterAccess.mock.invocationCallOrder[0],
  );
});

it("runs a model check with its reasoning effort and does not refresh the access catalog", async () => {
  const fixture = setup();
  const result = await fixture.service.run(
    fixture.admin,
    "connection",
    "model",
  );
  expect(fixture.timeout).toHaveBeenCalledWith(30000);
  expect(fixture.adapter.runModelTest).toHaveBeenCalledWith(
    {
      apiKey: "synthetic-key",
      model: "model",
      reasoningEffort: "high",
      zaiAccountType: "coding-plan",
    },
    expect.any(AbortSignal),
  );
  expect(result.detail).toMatchObject({ reasoningEffort: "high" });
  expect(fixture.catalog.loadAfterAccess).not.toHaveBeenCalled();
});

it("rejects unauthorized users and missing models before contacting the provider", async () => {
  const fixture = setup({ ...connection, testModel: null });
  await expect(
    fixture.service.run(fixture.other, "connection", "auth"),
  ).rejects.toThrow();
  await expect(
    fixture.service.run(fixture.admin, "connection", "model"),
  ).rejects.toMatchObject({ code: "test_model_required" });
  expect(fixture.repository.findSecretEncrypted).not.toHaveBeenCalled();
  expect(fixture.save).not.toHaveBeenCalled();
});

it("records unavailable credentials without calling the provider or loading the catalog", async () => {
  const fixture = setup();
  fixture.repository.findSecretEncrypted.mockResolvedValue(null);
  const result = await fixture.service.run(fixture.admin, "connection", "auth");
  expect(result).toMatchObject({
    status: "failed",
    errorCode: "secret_unavailable",
    detail: {},
  });
  expect(fixture.save).toHaveBeenCalledWith(
    "connection",
    "auth",
    result,
    "admin",
  );
  expect(fixture.adapter.checkAccess).not.toHaveBeenCalled();
  expect(fixture.catalog.loadAfterAccess).not.toHaveBeenCalled();
});

it("updates and clears CLI account state based on the check outcome", async () => {
  const fixture = setup({
    ...connection,
    provider: "opencode",
    cliLoggedInAt: "earlier",
    cliAccountLabel: "old",
  });
  fixture.cli.check.mockResolvedValueOnce({
    ok: true,
    detail: { modelProvider: "new" },
  });
  await fixture.service.run(fixture.admin, "connection", "model");
  expect(fixture.timeout).toHaveBeenCalledWith(45000);
  expect(fixture.repository.setCliAccount).toHaveBeenCalledWith(
    "connection",
    { loggedInAt: "earlier", label: "new" },
    "admin",
  );
  fixture.cli.check.mockResolvedValueOnce({
    ok: false,
    errorCode: "provider_auth_failed",
    detail: {},
  });
  const result = await fixture.service.run(fixture.admin, "connection", "auth");
  expect(result.status).toBe("failed");
  expect(fixture.repository.setCliAccount).toHaveBeenLastCalledWith(
    "connection",
    { loggedInAt: null, label: null },
    "admin",
  );
  expect(fixture.timeout).toHaveBeenLastCalledWith(25000);
});
