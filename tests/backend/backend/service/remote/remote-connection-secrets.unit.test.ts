import { beforeEach, describe, expect, it, vi } from "vitest";

import { logCaughtError } from "@/backend/logging/Logger";
import { registerLogSecret } from "@/backend/logging/LogRedaction";
import {
  decryptRemoteCredentials,
  encryptRemoteSecrets,
  testRemoteCredentials,
} from "@/backend/service/remote/RemoteConnectionSecrets";

import type { RemoteTypedSecrets } from "@/backend/service/remote/RemoteConnectionSecrets";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));
vi.mock("@/backend/logging/LogRedaction", () => ({
  registerLogSecret: vi.fn(),
}));

const cipher = {
  encrypt: vi.fn((binding: string, secret: string) => `${binding}=${secret}`),
  decrypt: vi.fn((binding: string, payload: string) => `${binding}=${payload}`),
};
const stored = {
  password: "saved-password",
  privateKey: "saved-key",
  passphrase: "saved-phrase",
};
const typed: RemoteTypedSecrets = {
  authMethod: "key_passphrase",
  password: "new-password",
  privateKey: "new-key",
  passphrase: "",
};

beforeEach(() => vi.clearAllMocks());

describe("remote connection secrets", () => {
  it("encrypts only the selected method and retains an empty stored secret", () => {
    expect(
      encryptRemoteSecrets({ connectionId: "c1", typed, stored }, cipher),
    ).toEqual({
      password: null,
      privateKey: "remote-ssh:c1:private_key=new-key",
      passphrase: "saved-phrase",
    });
    expect(cipher.encrypt).toHaveBeenCalledOnce();
    expect(cipher.encrypt).toHaveBeenCalledWith(
      "remote-ssh:c1:private_key",
      "new-key",
    );
  });

  it("switches to password and refuses a missing required secret", () => {
    const password = { ...typed, authMethod: "password" as const };
    expect(
      encryptRemoteSecrets(
        { connectionId: "c1", typed: password, stored },
        cipher,
      ),
    ).toEqual({
      password: "remote-ssh:c1:password=new-password",
      privateKey: null,
      passphrase: null,
    });
    expect(() =>
      encryptRemoteSecrets(
        {
          connectionId: "c1",
          typed: { ...password, password: "" },
          stored: null,
        },
        cipher,
      ),
    ).toThrow("remote_secret_required");
    expect(() =>
      encryptRemoteSecrets(
        {
          connectionId: "c1",
          typed: { ...typed, privateKey: "" },
          stored: null,
        },
        cipher,
      ),
    ).toThrow("remote_secret_required");
  });

  it("decrypts each stored field with its own binding and registers it for redaction", () => {
    expect(
      decryptRemoteCredentials(
        { id: "c1", authMethod: "key_passphrase", secrets: stored },
        cipher,
      ),
    ).toEqual({
      method: "key_passphrase",
      password: "remote-ssh:c1:password=saved-password",
      privateKey: "remote-ssh:c1:private_key=saved-key",
      passphrase: "remote-ssh:c1:passphrase=saved-phrase",
    });
    expect(registerLogSecret).toHaveBeenCalledTimes(3);
    expect(registerLogSecret).toHaveBeenCalledWith(
      "remote-ssh:c1:private_key=saved-key",
    );
  });
});

describe("remote credential decryption", () => {
  it("classifies a decryption failure without exposing the payload", () => {
    const error = new Error("cipher failure");
    cipher.decrypt.mockImplementationOnce(() => {
      throw error;
    });
    expect(() =>
      decryptRemoteCredentials(
        { id: "c1", authMethod: "password", secrets: stored },
        cipher,
      ),
    ).toThrow("remote_check_failed");
    expect(logCaughtError).toHaveBeenCalledWith(
      "RemoteConnectionSecrets",
      error,
    );
    expect(registerLogSecret).not.toHaveBeenCalled();
  });

  it("combines typed and stored values for a test and drops unrelated fields", () => {
    expect(
      testRemoteCredentials(
        typed,
        { id: "c1", authMethod: "password", secrets: stored },
        cipher,
      ),
    ).toEqual({
      method: "key_passphrase",
      password: null,
      privateKey: "new-key",
      passphrase: "remote-ssh:c1:passphrase=saved-phrase",
    });
    expect(
      testRemoteCredentials(
        { ...typed, authMethod: "password", password: "" },
        null,
        cipher,
      ),
    ).toEqual({
      method: "password",
      password: null,
      privateKey: null,
      passphrase: null,
    });
  });
});
