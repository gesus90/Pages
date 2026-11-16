import { describe, expect, it, vi } from "vitest";

import { PicaMobilePushRegistrationRepository } from "@/backend/database/repositories/mobile/PicaMobilePushRegistrationRepository";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { DatabaseTransaction } from "@/backend/database/Database";

const row = [
  "device",
  "account",
  "session",
  "fingerprint",
  "cipher",
  "en",
  "details",
  "old",
  "now",
  null,
];
const binding = {
  deviceId: "device",
  accountId: "account",
  sessionId: "session",
  tokenFingerprint: "fingerprint",
  tokenEncrypted: "cipher",
  locale: "en" as const,
  preview: "details" as const,
  now: "now",
};

function fixture(): {
  repository: PicaMobilePushRegistrationRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  const execute = vi.fn().mockResolvedValue(undefined);
  const transaction = partial<DatabaseTransaction>({ query, execute });
  return {
    repository: new PicaMobilePushRegistrationRepository({
      query,
      execute,
      transaction: async (work) => work(transaction),
    }),
    query,
    execute,
  };
}

describe("mobile push registration storage", () => {
  it("binds a new registration and displaces moved and excess devices", async () => {
    const { repository, query, execute } = fixture();
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([["moved"]])
      .mockResolvedValueOnce([["old"], ["device"]])
      .mockResolvedValueOnce([row]);
    await expect(repository.bind(binding, 1)).resolves.toMatchObject({
      registration: { deviceId: "device", activatedAt: null },
      displacedDeviceIds: ["moved", "old"],
    });
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it("renews or takes over a device and requires a stored result", async () => {
    const { repository, query } = fixture();
    query
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([["device"]])
      .mockResolvedValueOnce([row]);
    await expect(repository.bind(binding, 2)).resolves.toMatchObject({
      displacedDeviceIds: [],
    });
    query
      .mockResolvedValueOnce([[...row.slice(0, 1), "other", ...row.slice(2)]])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([["device"]])
      .mockResolvedValueOnce([]);
    await expect(repository.bind(binding, 2)).rejects.toThrow("not stored");
  });

  it("removes only the matching account and exact token binding", async () => {
    const { repository, query, execute } = fixture();
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([row]);
    await repository.removeOwn("device", "account", "now");
    await repository.removeOwn("device", "other", "now");
    await repository.removeOwn("device", "account", "now");
    await repository.removeBinding(
      { deviceId: "device", tokenFingerprint: "wrong", sessionId: "session" },
      "now",
    );
    await repository.removeBinding(
      {
        deviceId: "device",
        tokenFingerprint: "fingerprint",
        sessionId: "session",
      },
      "now",
    );
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("validates stored locale and preview values", async () => {
    const { repository, query } = fixture();
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([[...row.slice(0, 5), "fr", ...row.slice(6)]])
      .mockResolvedValueOnce([[...row.slice(0, 6), "invalid", ...row.slice(7)]])
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([row]);
    await expect(repository.find("device")).resolves.toBeNull();
    await expect(repository.find("device")).rejects.toThrow("locale");
    await expect(repository.find("device")).rejects.toThrow("preview");
    await expect(repository.listActivated("account")).resolves.toHaveLength(1);
    await expect(repository.listAll()).resolves.toHaveLength(1);
  });
});
