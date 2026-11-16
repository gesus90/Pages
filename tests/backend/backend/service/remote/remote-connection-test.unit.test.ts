import { expect, it, vi } from "vitest";

import {
  remoteCheckOf,
  remoteFailureStage,
  testRemoteConnection,
} from "@/backend/service/remote/RemoteConnectionTest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { SshClient } from "@/backend/remote/SshClient";
import type { RemoteTestSubject } from "@/backend/service/remote/RemoteConnectionTest";
import type { RemoteHostKey } from "@/definition/RemoteConnection";

const KEY = partial<RemoteHostKey>({
  algorithm: "ssh-ed25519",
  key: "key",
  fingerprint: "fingerprint",
});
const SUBJECT = partial<RemoteTestSubject>({
  alias: "alias",
  host: "host",
  port: 22,
  username: "user",
  credentials: { method: "password", password: "secret" },
  pinnedHostKey: KEY,
});

it("does not authenticate an unreachable or unconfirmed host", async () => {
  const authenticate = vi.fn(async () => null);
  const scanHostKey = vi.fn(async () => KEY);
  const client = partial<SshClient>({
    probe: async () => "unreachable_timeout",
    scanHostKey,
    authenticate,
  });
  const unreachable = await testRemoteConnection(client, SUBJECT);
  expect(unreachable.reachability).toEqual({
    state: "failed",
    code: "unreachable_timeout",
  });
  expect(scanHostKey).not.toHaveBeenCalled();
  const unconfirmed = await testRemoteConnection(
    partial<SshClient>({
      probe: async () => null,
      scanHostKey,
      authenticate,
    }),
    { ...SUBJECT, pinnedHostKey: null },
  );
  expect(unconfirmed.hostKey).toEqual({
    state: "failed",
    code: "host_key_unconfirmed",
  });
  expect(authenticate).not.toHaveBeenCalled();
});

it("authenticates only after the confirmed key and summarizes the first failure", async () => {
  const client = partial<SshClient>({
    probe: async () => null,
    scanHostKey: async () => KEY,
    authenticate: async () => "password_rejected",
  });
  const result = await testRemoteConnection(client, SUBJECT);
  expect(result.hostKey.state).toBe("passed");
  expect(result.authentication).toEqual({
    state: "failed",
    code: "password_rejected",
  });
  expect(remoteCheckOf(result)).toMatchObject({
    stage: "authentication",
    code: "password_rejected",
  });
  expect(remoteFailureStage("host_key_changed")).toBe("host_key");
  expect(remoteFailureStage(null)).toBeNull();
});
