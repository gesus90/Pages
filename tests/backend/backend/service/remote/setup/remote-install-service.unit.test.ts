import { expect, it, vi } from "vitest";

import { RemoteInstallService } from "@/backend/service/remote/setup/RemoteInstallService";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { RemoteConnectionRepository } from "@/backend/database/repositories/remote/RemoteConnectionRepository";
import type { RemoteInstallFindingRepository } from "@/backend/database/repositories/remote/RemoteInstallFindingRepository";
import type { RemoteSessionRegistry } from "@/backend/remote/RemoteSessionRegistry";

const CONNECTION = {
  id: "connection",
  host: "host",
  port: 22,
  username: "user",
  hostKey: { fingerprint: "key" },
};

it("stores a probe only while the pinned connection identity remains current", async () => {
  const find = vi.fn(async () => CONNECTION);
  const save = vi.fn(async () => {});
  const run = vi.fn(async () => ({ exitCode: 0, stdout: "probe=complete" }));
  const service = new RemoteInstallService({
    connections: partial<RemoteConnectionRepository>({ find }),
    findings: partial<RemoteInstallFindingRepository>({ save }),
    sessions: partial<RemoteSessionRegistry>({ session: () => ({ run }) }),
  });
  await service.inspect("connection");
  expect(run).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledWith(
    "connection",
    expect.objectContaining({
      binding: {
        host: "host",
        port: 22,
        username: "user",
        hostKeyFingerprint: "key",
      },
    }),
  );
});

it("ignores findings for a changed host key and returns unknown for a missing connection", async () => {
  const find = vi.fn(async () => ({
    binding: {
      host: "host",
      port: 22,
      username: "user",
      hostKeyFingerprint: "old",
    },
  }));
  const service = new RemoteInstallService({
    connections: partial<RemoteConnectionRepository>({
      find: async () => null,
    }),
    findings: partial<RemoteInstallFindingRepository>({ find }),
    sessions: partial<RemoteSessionRegistry>({}),
  });
  await expect(service.current("missing")).resolves.toMatchObject({
    state: "unknown",
  });
  const views = await service.views([partial(CONNECTION)]);
  expect(views.connection?.state).toBe("unknown");
});
