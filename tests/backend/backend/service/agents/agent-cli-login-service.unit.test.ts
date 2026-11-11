import { expect, it, vi } from "vitest";

import { AgentCliLoginService } from "@/backend/service/agents/AgentCliLoginService";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";

import { PageAgentWorld } from "./page-agent-world";

import type { Mock } from "vitest";

import type { CliHome } from "@/backend/agents/cli/CliContracts";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";

const connection: AgentConnectionRecord = {
  id: "connection",
  name: "CLI",
  provider: "opencode",
  isActive: true,
  hasApiKey: false,
  testModel: null,
  reasoningEffort: null,
  cliLoggedInAt: null,
  cliAccountLabel: null,
  updatedAt: "2026-01-01",
};

interface LoginFixture {
  service: AgentCliLoginService;
  admin: AccountAccess;
  other: AccountAccess;
  repository: {
    find: Mock<() => Promise<AgentConnectionRecord>>;
    setCliAccount: Mock<() => Promise<void>>;
  };
  store: { paths: Mock<() => CliHome>; secure: Mock<() => Promise<void>> };
  adapter: { storeKey: Mock<() => Promise<void>> };
  runtime: { cleanup: Mock<() => Promise<void>> };
  runner: { shutdown: Mock<() => Promise<void>> };
  catalog: { loadAfterAccess: Mock<() => Promise<void>> };
}

function setup(): LoginFixture {
  const world = new PageAgentWorld();
  world.addPerson("admin", { isAdmin: true });
  world.addPerson("other");
  const [admin, other] = world.snapshot().accounts;
  const home = {
    root: "/synthetic",
    home: "/synthetic/home",
    config: "/synthetic/config",
    work: "/synthetic/work",
  };
  const repository = {
    find: vi.fn(async () => connection),
    setCliAccount: vi.fn(async () => {}),
    catalogs: () => ({ invalidate: vi.fn(async () => {}) }),
  };
  const store = {
    paths: vi.fn(() => home),
    isBound: vi.fn(() => false),
    prepare: vi.fn(async () => home),
    secure: vi.fn(async () => {}),
  };
  const adapter = {
    version: vi.fn(async () => ({ ok: true })),
    storeKey: vi.fn(async () => {}),
    readStatus: vi.fn(async () => ({
      outcome: { ok: true },
      accountLabel: "account",
    })),
  };
  const runtime = {
    openCode: vi.fn(async () => adapter),
    cleanup: vi.fn(async () => {}),
  };
  const locator = {
    find: vi.fn(async () => ({ found: false, path: null })),
    list: vi.fn(async () => ({})),
  };
  const runner = { shutdown: vi.fn(async () => {}) };
  const catalog = { loadAfterAccess: vi.fn(async () => {}) };
  const dependencies = {
    repository,
    store,
    runtime,
    locator,
    runner,
    catalog,
    operations: new AgentOperationRegistry(),
  };
  const service = new AgentCliLoginService(
    dependencies as unknown as ConstructorParameters<
      typeof AgentCliLoginService
    >[0],
  );
  return {
    service,
    admin,
    other,
    repository,
    store,
    adapter,
    runtime,
    runner,
    catalog,
  };
}

it("validates administrator and key input before touching credentials", async () => {
  const { service, admin, other, repository } = setup();
  await expect(service.tools(other)).rejects.toThrow();
  for (const apiKey of ["", "has space", "x".repeat(513)]) {
    await expect(
      service.storeKey(admin, "connection", {
        modelProvider: "openrouter",
        apiKey,
      }),
    ).rejects.toMatchObject({ code: "api_key_invalid_format" });
  }
  expect(repository.find).not.toHaveBeenCalled();
});

it("stores and confirms an OpenCode key before showing account state", async () => {
  const { service, admin, repository, store, adapter, catalog } = setup();
  const input = { modelProvider: "openrouter", apiKey: "synthetic-key" };
  const state = await service.storeKey(admin, "connection", input);
  expect(adapter.storeKey).toHaveBeenCalledWith(store.paths(), input);
  expect(store.secure).toHaveBeenCalledWith("connection", "opencode");
  expect(repository.setCliAccount).toHaveBeenCalledTimes(2);
  expect(repository.setCliAccount).toHaveBeenLastCalledWith(
    "connection",
    { loggedInAt: expect.any(String) as unknown, label: "account" },
    "admin",
  );
  expect(catalog.loadAfterAccess).toHaveBeenCalledWith("connection");
  expect(state).toMatchObject({ binaryFound: false, login: null });
});

it("rejects codes and cancellation without an active login", async () => {
  const { service, admin } = setup();
  await expect(
    service.submitCode(admin, "connection", " "),
  ).rejects.toMatchObject({ code: "login_code_invalid" });
  await expect(
    service.submitCode(admin, "connection", "123"),
  ).rejects.toMatchObject({ code: "login_not_running" });
  await expect(
    service.submitRedirect(admin, "connection", "http://localhost/"),
  ).rejects.toMatchObject({ code: "login_not_running" });
  await expect(service.cancel(admin, "connection")).rejects.toMatchObject({
    code: "login_not_running",
  });
  expect(await service.read(admin, "connection")).toBeNull();
});

it("cleans credentials on logout and rejects new logins after shutdown", async () => {
  const { service, admin, runtime, repository, runner } = setup();
  await service.logout(admin, "connection");
  expect(runtime.cleanup).toHaveBeenCalledWith(connection);
  expect(repository.setCliAccount).toHaveBeenCalledWith(
    "connection",
    { loggedInAt: null, label: null },
    "admin",
  );
  await service.shutdown();
  expect(runner.shutdown).toHaveBeenCalledOnce();
  await expect(service.start(admin, "connection")).rejects.toMatchObject({
    code: "login_limit_reached",
  });
});
