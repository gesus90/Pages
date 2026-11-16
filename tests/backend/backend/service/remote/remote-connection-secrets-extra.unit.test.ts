import { expect, it, vi } from "vitest";

import {
  decryptRemoteCredentials,
  encryptRemoteSecrets,
  testRemoteCredentials,
} from "@/backend/service/remote/RemoteConnectionSecrets";

import type { RemoteSecretCipher } from "@/backend/service/remote/RemoteConnectionSecrets";

const CIPHER: RemoteSecretCipher = {
  encrypt: (binding, text) => `${binding}:${text}`,
  decrypt: (binding, text) => {
    expect(binding).toContain("remote-ssh:");
    return text;
  },
};

it("binds newly typed secrets to connection and kind, retaining only the chosen method", () => {
  const encrypt = vi.fn(CIPHER.encrypt);
  const cipher = { ...CIPHER, encrypt };
  expect(
    encryptRemoteSecrets(
      {
        connectionId: "connection",
        typed: {
          authMethod: "password",
          password: "example",
          privateKey: "",
          passphrase: "",
        },
        stored: null,
      },
      cipher,
    ),
  ).toEqual({
    password: "remote-ssh:connection:password:example",
    privateKey: null,
    passphrase: null,
  });
  expect(encrypt).toHaveBeenCalledOnce();
  expect(() =>
    encryptRemoteSecrets(
      {
        connectionId: "connection",
        typed: {
          authMethod: "password",
          password: "",
          privateKey: "",
          passphrase: "",
        },
        stored: null,
      },
      cipher,
    ),
  ).toThrow();
});

it("uses stored values for blank dialog fields and suppresses irrelevant secrets", () => {
  const stored = {
    id: "connection",
    authMethod: "password" as const,
    secrets: { password: "saved", privateKey: null, passphrase: null },
  };
  expect(decryptRemoteCredentials(stored, CIPHER)).toEqual({
    method: "password",
    password: "saved",
    privateKey: null,
    passphrase: null,
  });
  expect(
    testRemoteCredentials(
      {
        authMethod: "password",
        password: "",
        privateKey: "ignored",
        passphrase: "ignored",
      },
      stored,
      CIPHER,
    ),
  ).toEqual({
    method: "password",
    password: "saved",
    privateKey: null,
    passphrase: null,
  });
});
