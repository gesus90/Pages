import { expect, it, vi } from "vitest";

import { RunnerMaintenanceRepository } from "./RunnerMaintenanceRepository";

import type { Database } from "@/backend/database/Database";

type Call = (...parameters: unknown[]) => Promise<undefined>;

function doubleOf(rows: unknown[][]): {
  repository: RunnerMaintenanceRepository;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn<Call>(async () => undefined);
  const database = {
    query: vi.fn(async () => rows),
    execute,
  } as unknown as Database;
  return { repository: new RunnerMaintenanceRepository(database), execute };
}

it("falls back to safe settings without a stored row", async () => {
  const { repository } = doubleOf([]);

  expect(await repository.settings()).toEqual({
    address: null,
    allowInsecureLan: false,
    automaticUpdates: true,
  });
});

it("parses stored settings", async () => {
  const settings = {
    address: "https://pages.example",
    allowInsecureLan: true,
    automaticUpdates: false,
  };
  const { repository } = doubleOf([[JSON.stringify(settings)]]);

  expect(await repository.settings()).toEqual(settings);
});

it("saves settings as one JSON document", async () => {
  const { repository, execute } = doubleOf([]);
  const settings = {
    address: null,
    allowInsecureLan: false,
    automaticUpdates: true,
  };

  await repository.save(settings);

  expect(execute.mock.calls[0]?.[1]).toEqual({
    settings_json: JSON.stringify(settings),
  });
});

it("keeps a manual request", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.request("c1");

  expect(execute.mock.calls[0]?.[1]).toEqual({ connection_id: "c1" });
});

it("reports no intent and no receipt for an unknown connection", async () => {
  const { repository } = doubleOf([]);

  expect(await repository.state("c1")).toEqual({
    requested: false,
    receipt: null,
  });
});

it("reports intent without a receipt", async () => {
  const { repository } = doubleOf([["true", null]]);

  expect(await repository.state("c1")).toEqual({
    requested: true,
    receipt: null,
  });
});

it("reads the stored receipt", async () => {
  const receipt = {
    version: 1,
    type: "maintenance",
    sessionId: "11111111-1111-4111-8111-111111111111",
    runnerVersion: "1.2.3",
    updateVersion: 1,
    status: "idle",
  };
  const { repository } = doubleOf([["false", JSON.stringify(receipt)]]);

  const state = await repository.state("c1");

  expect(state.requested).toBe(false);
  expect(state.receipt?.status).toBe("idle");
});

it("records a receipt and the verification flag", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.record(
    "c1",
    { outcome: "failed" } as unknown as never,
    true,
  );

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    connection_id: "c1",
    verified: true,
  });
});
