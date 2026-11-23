import { expect, it, vi } from "vitest";

import { AgentSessionSettingsRepository } from "./AgentSessionSettingsRepository";

import type { Database } from "@/backend/database/Database";

function doubleOf(rows: unknown[][]): {
  repository: AgentSessionSettingsRepository;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  return {
    repository: new AgentSessionSettingsRepository({
      query,
    } as unknown as Database),
    query,
  };
}

const limits = {
  perAgent: 2,
  total: 8,
  revision: 3,
  dreamTime: "03:00",
  idleMinutes: 15,
};

it("reads the limits of the instance", async () => {
  const { repository } = doubleOf([[2, 8, 3, "03:00", 15]]);

  expect(await repository.read()).toEqual(limits);
});

it("rejects reading without a row", async () => {
  const { repository } = doubleOf([]);

  await expect(repository.read()).rejects.toMatchObject({
    code: "profile_invalid",
  });
});

it("saves the limits with their revision", async () => {
  const { repository, query } = doubleOf([["1"]]);

  await repository.save(limits);

  expect(query.mock.calls[0]?.[1]).toEqual({
    per_agent_limit: 2,
    total_limit: 8,
    dream_time: "03:00",
    idle_minutes: 15,
    revision: 3,
  });
});

it("rejects saving a stale revision", async () => {
  const { repository } = doubleOf([]);

  await expect(repository.save(limits)).rejects.toMatchObject({
    code: "profile_conflict",
  });
});

it("reads the logbook model", async () => {
  const { repository } = doubleOf([["c1", "m1"]]);

  expect(await repository.logbookModel()).toEqual({
    connectionId: "c1",
    model: "m1",
  });
});

it("reads no logbook model without a row or with a missing part", async () => {
  expect(await doubleOf([]).repository.logbookModel()).toBeNull();
  expect(await doubleOf([[null, "m1"]]).repository.logbookModel()).toBeNull();
  expect(await doubleOf([["c1", null]]).repository.logbookModel()).toBeNull();
});

it("saves and clears the logbook model", async () => {
  const { repository, query } = doubleOf([]);

  await repository.saveLogbookModel({ connectionId: "c1", model: "m1" });
  await repository.saveLogbookModel(null);

  expect(query.mock.calls[0]?.[1]).toEqual({
    connection_id: "c1",
    model: "m1",
  });
  expect(query.mock.calls[1]?.[1]).toEqual({
    connection_id: null,
    model: null,
  });
});
