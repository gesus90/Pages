import { describe, expect, it, vi } from "vitest";

import {
  remoteCheckOf,
  remoteFailureStage,
  testRemoteConnection,
} from "./RemoteConnectionTest";

import type { Mock } from "vitest";
import type { RemoteTestSubject } from "./RemoteConnectionTest";
import type {
  RemoteFailureCode,
  RemoteHostKey,
  RemoteTestResult,
} from "@/definition/RemoteConnection";

const KEY: RemoteHostKey = {
  algorithm: "ssh-ed25519",
  key: "AAA",
  fingerprint: "SHA256:a",
};
const OTHER: RemoteHostKey = {
  algorithm: "ssh-ed25519",
  key: "BBB",
  fingerprint: "SHA256:b",
};

function subjectOf(pinned: RemoteHostKey | null): RemoteTestSubject {
  return {
    alias: "alias",
    host: "host",
    port: 22,
    username: "user",
    credentials: {
      method: "password",
      password: "p",
      privateKey: null,
      passphrase: null,
    },
    pinnedHostKey: pinned,
  };
}

interface ClientDouble {
  readonly probe: Mock<() => Promise<RemoteFailureCode | null>>;
  readonly scanHostKey: Mock<() => Promise<RemoteHostKey | RemoteFailureCode>>;
  readonly authenticate: Mock<() => Promise<RemoteFailureCode | null>>;
}

function clientOf(
  probe: RemoteFailureCode | null,
  scan: RemoteHostKey | RemoteFailureCode,
  authenticate: RemoteFailureCode | null = null,
): ClientDouble {
  return {
    probe: vi.fn(async () => probe),
    scanHostKey: vi.fn(async () => scan),
    authenticate: vi.fn(async () => authenticate),
  };
}

describe("remoteFailureStage", () => {
  it("maps failures to their stage", () => {
    expect(remoteFailureStage(null)).toBeNull();
    expect(remoteFailureStage("not_ssh")).toBe("reachability");
    expect(remoteFailureStage("host_key_changed")).toBe("host_key");
    expect(remoteFailureStage("auth_failed" as RemoteFailureCode)).toBe(
      "authentication",
    );
  });
});

describe("testRemoteConnection", () => {
  it("stops at an unreachable machine", async () => {
    const client = clientOf("unreachable_timeout", KEY);
    const result = await testRemoteConnection(client, subjectOf(KEY));
    expect(result.reachability).toEqual({
      state: "failed",
      code: "unreachable_timeout",
    });
    expect(result.hostKey.state).toBe("skipped");
    expect(client.scanHostKey).not.toHaveBeenCalled();
  });

  it("reports a failed key scan", async () => {
    const result = await testRemoteConnection(
      clientOf(null, "host_key_unconfirmed"),
      subjectOf(KEY),
    );
    expect(result.hostKey).toEqual({
      state: "failed",
      code: "host_key_unconfirmed",
    });
    expect(result.presentedHostKey).toBeNull();
  });

  it("shows the key of a first test without signing in", async () => {
    const client = clientOf(null, KEY);
    const result = await testRemoteConnection(client, subjectOf(null));
    expect(result.hostKey.code).toBe("host_key_unconfirmed");
    expect(result.presentedHostKey).toBe(KEY);
    expect(client.authenticate).not.toHaveBeenCalled();
  });

  it("flags a changed key", async () => {
    const result = await testRemoteConnection(
      clientOf(null, OTHER),
      subjectOf(KEY),
    );
    expect(result.hostKey.code).toBe("host_key_changed");
  });

  it("signs in with a confirmed key", async () => {
    const passed = await testRemoteConnection(
      clientOf(null, KEY),
      subjectOf(KEY),
    );
    expect(passed.authentication.state).toBe("passed");
    const refused = await testRemoteConnection(
      clientOf(null, KEY, "auth_failed" as RemoteFailureCode),
      subjectOf(KEY),
    );
    expect(refused.authentication.state).toBe("failed");
  });
});

describe("remoteCheckOf", () => {
  const passed = { state: "passed", code: null } as const;
  const base: RemoteTestResult = {
    reachability: passed,
    hostKey: passed,
    authentication: passed,
    presentedHostKey: null,
    testedAt: "t",
  };

  it("condenses a passed test", () => {
    expect(remoteCheckOf(base)).toEqual({
      checkedAt: "t",
      stage: null,
      code: null,
    });
  });

  it("names the first failed stage", () => {
    const failed = { state: "failed", code: "host_key_changed" } as const;
    expect(remoteCheckOf({ ...base, hostKey: failed })).toEqual({
      checkedAt: "t",
      stage: "host_key",
      code: "host_key_changed",
    });
  });
});
