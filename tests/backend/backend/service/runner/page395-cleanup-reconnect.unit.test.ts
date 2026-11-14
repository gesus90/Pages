import { expect, it, vi } from "vitest";

import { RunnerService } from "@/backend/service/runner/RunnerService";
import { partial } from "../../../app/lib/service-wiring-fakes";

import type { RunnerRecord } from "@/backend/database/repositories/runner/RunnerRepository";
import type {
  RunnerConnectionAccess,
  RunnerStore,
} from "@/backend/service/runner/RunnerServiceSupport";

it("resets cleanup after a reconnect with the same durable session ID, once per contact transition", async () => {
  let record: RunnerRecord = {
    connectionId: "connection",
    runnerId: "runner",
    tokenHash: "digest",
    connectionRevision: 1,
    state: {
      version: 1,
      sessionId: "f3596d91-60b7-4131-823e-2b7f805c1089",
      sequence: 0,
      lastEventId: null,
      jobs: [],
    },
  };
  const reconnected = vi.fn(async () => undefined);
  const repository: RunnerStore = {
    find: async () => record,
    create: vi.fn(),
    remove: vi.fn(),
    reconnected,
    checkpoint: async (_connection, state) => {
      record = { ...record, state };
    },
  };
  const service = new RunnerService(
    repository,
    partial<RunnerConnectionAccess>({ scopeForRunner: async () => 1 }),
  );
  const message = {
    version: 1,
    type: "reconcile",
    sessionId: "f3596d91-60b7-4131-823e-2b7f805c1089",
    sequence: 0,
    jobs: [],
  };
  await service.receive("connection", message);
  expect(reconnected).toHaveBeenCalledExactlyOnceWith("connection");
  await service.receive("connection", message);
  expect(reconnected).toHaveBeenCalledTimes(1);
  service.disconnected("connection");
  await service.receive("connection", message);
  expect(reconnected).toHaveBeenCalledTimes(2);
});
