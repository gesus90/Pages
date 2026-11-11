import { afterEach, expect, it, vi } from "vitest";

import { RunnerService } from "@/backend/service/runner/RunnerService";
import { digest } from "@/backend/service/runner/RunnerServiceSupport";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { RunnerRecord } from "@/backend/database/repositories/runner/RunnerRepository";
import type { RemoteConnectionView } from "@/definition/RemoteConnection";
import type {
  RunnerConnectionAccess,
  RunnerStore,
} from "@/backend/service/runner/RunnerServiceSupport";

const CONNECTION = "connection";

function world(initial: RunnerRecord | null = null): {
  readonly service: RunnerService;
  readonly record: () => RunnerRecord | null;
  readonly remove: ReturnType<typeof vi.fn>;
  readonly setRevision: (revision: number) => void;
} {
  let stored = initial;
  let revision = 1;
  const remove = vi.fn(async () => {
    stored = null;
  });
  const connection = partial<RemoteConnectionView>({
    id: CONNECTION,
    name: "Runner host",
    host: "synthetic.invalid",
    port: 22,
    username: "runner",
    departmentName: null,
    hostKey: { fingerprint: "synthetic" },
    isChecking: false,
    lastCheck: { code: null, checkedAt: "2026-01-01T00:00:00.000Z" },
    session: { status: "connected", connectedAt: "2026-01-01T00:00:00.000Z" },
    revision: 1,
  });
  const repository: RunnerStore = {
    find: async () => stored,
    create: async (record) => {
      stored = record;
    },
    checkpoint: async (connectionId, state) => {
      if (connectionId !== CONNECTION) throw new Error("Unexpected runner");
      if (stored) stored = { ...stored, state };
    },
    remove,
  };
  const connections = partial<RunnerConnectionAccess>({
    scope: async () => ({ canManage: true, connections: [connection] }),
    scopeForRunner: async () => revision,
    requireUsable: async () => ({ revision }),
  });
  return {
    service: new RunnerService(repository, connections),
    record: () => stored,
    remove,
    setRevision: (next) => {
      revision = next;
    },
  };
}

afterEach(() => vi.useRealTimers());

it("pairs once with a short-lived grant and authenticates the durable token", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:01:00Z"));
  const { service, record } = world();
  const grant = await service.authorize("admin", CONNECTION);
  expect(grant.expiresAt).toBe("2026-01-01T00:03:00.000Z");
  await expect(service.authenticate(CONNECTION, "wrong")).rejects.toThrow(
    "Invalid runner grant",
  );
  const paired = await service.authenticate(CONNECTION, grant.grant);
  expect(paired.token).toEqual(expect.any(String));
  expect(record()?.tokenHash).toBe(digest(paired.token ?? ""));
  await expect(service.authenticate(CONNECTION, grant.grant)).rejects.toThrow(
    "Invalid runner credential",
  );
  await expect(
    service.authenticate(CONNECTION, paired.token ?? ""),
  ).resolves.toEqual({
    ...paired,
    token: null,
  });
  await expect(service.authorize("admin", CONNECTION)).rejects.toThrow(
    "Stable SSH connection without runner required",
  );
});

it("rejects expired grants, changed revisions and overlong credentials", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:01:00Z"));
  const { service, setRevision } = world();
  const grant = await service.authorize("admin", CONNECTION);
  vi.advanceTimersByTime(120_000);
  await expect(service.authenticate(CONNECTION, grant.grant)).rejects.toThrow(
    "Invalid runner grant",
  );
  const next = await service.authorize("admin", CONNECTION);
  setRevision(2);
  await expect(service.authenticate(CONNECTION, next.grant)).rejects.toThrow(
    "Runner configuration changed",
  );
  await expect(
    service.authenticate(CONNECTION, "x".repeat(201)),
  ).rejects.toThrow("Invalid runner credential");
});

it("tracks pairing and liveness, then revokes the registration", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:01:00Z"));
  const { service, remove, setRevision } = world({
    connectionId: CONNECTION,
    runnerId: "runner",
    tokenHash: digest("token"),
    connectionRevision: 1,
    state: {
      version: 1,
      sessionId: "session",
      sequence: 0,
      lastEventId: null,
      jobs: [],
    },
  });
  expect(await service.status(CONNECTION)).toEqual({
    isPaired: true,
    isReady: false,
  });
  expect(await service.availability(CONNECTION)).toBe("remoteOffline");
  service.heartbeat(CONNECTION);
  expect(service.contact(CONNECTION)).toEqual({
    state: "connected",
    lastContactAt: "2026-01-01T00:01:00.000Z",
  });
  setRevision(2);
  expect(await service.status(CONNECTION)).toEqual({
    isPaired: false,
    isReady: false,
  });
  expect(await service.availability(CONNECTION)).toBe("remoteIdentity");
  await expect(service.authenticate(CONNECTION, "token")).rejects.toThrow(
    "Runner connection revoked or changed",
  );
  await service.revoke("admin", CONNECTION);
  expect(remove).toHaveBeenCalledWith(CONNECTION);
  expect(service.contact(CONNECTION).state).toBe("lost");
  expect(await service.status(CONNECTION)).toEqual({
    isPaired: false,
    isReady: false,
  });
});
