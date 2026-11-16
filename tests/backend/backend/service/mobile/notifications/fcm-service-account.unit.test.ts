import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  facts: vi.fn(),
  key: vi.fn(),
  log: vi.fn(),
  caught: vi.fn(),
  open: vi.fn(),
  read: vi.fn(),
}));

vi.mock("node:fs", () => ({
  closeSync: mocks.close,
  fstatSync: mocks.facts,
  openSync: mocks.open,
  readFileSync: mocks.read,
}));
vi.mock("node:crypto", () => ({ createPrivateKey: mocks.key }));
vi.mock("@/backend/logging/Logger", () => ({
  logEvent: mocks.log,
  logCaughtError: mocks.caught,
}));

import {
  FCM_TOKEN_ENDPOINT,
  readFcmServiceAccount,
} from "@/backend/service/mobile/notifications/FcmServiceAccount";

const account = {
  type: "service_account",
  project_id: "project-123",
  client_email: "service@example.com",
  private_key: "private key",
};

function reason(): unknown {
  return mocks.log.mock.calls.at(-1)?.[0].metadata.reason;
}

describe("FCM service-account file validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.open.mockReturnValue(8);
    mocks.facts.mockReturnValue({ isFile: () => true, size: 100, mode: 0o600 });
    mocks.read.mockReturnValue(JSON.stringify(account));
    mocks.key.mockReturnValue({ asymmetricKeyType: "rsa" });
  });

  it("loads an RSA account and closes the descriptor", () => {
    expect(readFcmServiceAccount("account.json")).toEqual({
      projectId: account.project_id,
      clientEmail: account.client_email,
      privateKey: account.private_key,
    });
    expect(mocks.close).toHaveBeenCalledWith(8);
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it.each(["not json", "null", "[]"])(
    "rejects malformed JSON or non-object: %s",
    (content) => {
      mocks.read.mockReturnValue(content);
      expect(readFcmServiceAccount("account.json")).toBeNull();
      expect(reason()).toBe("invalid_json");
    },
  );

  it.each([
    { ...account, token_uri: "https://example.com/token" },
    { ...account, type: "other" },
    { ...account, project_id: "bad" },
    { ...account, client_email: "invalid" },
    { ...account, private_key: "" },
  ])("rejects invalid fields without exposing the file", (fields) => {
    mocks.read.mockReturnValue(JSON.stringify(fields));
    expect(readFcmServiceAccount("account.json")).toBeNull();
    expect(reason()).toBe("invalid_fields");
    expect(mocks.key).not.toHaveBeenCalled();
  });

  it("accepts the fixed token endpoint and warns about open file permissions", () => {
    mocks.read.mockReturnValue(
      JSON.stringify({ ...account, token_uri: FCM_TOKEN_ENDPOINT }),
    );
    mocks.facts.mockReturnValue({ isFile: () => true, size: 100, mode: 0o644 });
    expect(readFcmServiceAccount("account.json")).not.toBeNull();
    if (process.platform !== "win32")
      expect(reason()).toBe("file_permissions_open");
  });

  it.each(["ec", "throws"])("rejects unusable keys: %s", (kind) => {
    if (kind === "throws")
      mocks.key.mockImplementation(() => {
        throw new Error("private key");
      });
    else mocks.key.mockReturnValue({ asymmetricKeyType: kind });
    expect(readFcmServiceAccount("account.json")).toBeNull();
    expect(reason()).toBe("invalid_key");
    expect(mocks.caught).not.toHaveBeenCalled();
  });

  it.each([
    { isFile: () => false, size: 1, mode: 0o600 },
    { isFile: () => true, size: 65_537, mode: 0o600 },
  ])("rejects unsuitable files and closes them", (facts) => {
    mocks.facts.mockReturnValue(facts);
    expect(readFcmServiceAccount("account.json")).toBeNull();
    expect(reason()).toBe("file_unreadable");
    expect(mocks.close).toHaveBeenCalledWith(8);
  });

  it("handles read and close errors without exposing account contents", () => {
    mocks.read.mockImplementation(() => {
      throw new Error("read failure");
    });
    mocks.close.mockImplementation(() => {
      throw new Error("close failure");
    });
    expect(readFcmServiceAccount("account.json")).toBeNull();
    expect(reason()).toBe("file_unreadable");
    expect(mocks.caught).toHaveBeenCalledTimes(2);
  });
});
