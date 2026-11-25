import { beforeEach, describe, expect, it, vi } from "vitest";

import { RemoteError } from "@/backend/error/RemoteErrors";

import {
  decryptRemoteCredentials,
  encryptRemoteSecrets,
  testRemoteCredentials,
} from "./RemoteConnectionSecrets";

import type {
  RemoteSecretCipher,
  RemoteTypedSecrets,
} from "./RemoteConnectionSecrets";
import type { RemoteAuthMethod } from "@/definition/RemoteConnection";

const logging = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  registerLogSecret: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: logging.logCaughtError,
}));
vi.mock("@/backend/logging/LogRedaction", () => ({
  registerLogSecret: logging.registerLogSecret,
}));

function cipherOf(): RemoteSecretCipher {
  return {
    encrypt: vi.fn(
      (binding: string, text: string) => `enc(${binding}|${text})`,
    ),
    decrypt: vi.fn((binding: string, payload: string) => {
      if (payload === "broken") throw new Error("bad");
      return `dec(${binding}|${payload})`;
    }),
  };
}

function typedOf(
  authMethod: RemoteAuthMethod,
  overrides: Partial<RemoteTypedSecrets> = {},
): RemoteTypedSecrets {
  return {
    authMethod,
    password: "",
    privateKey: "",
    passphrase: "",
    ...overrides,
  };
}

const STORED = { password: "sp", privateKey: "sk", passphrase: "ss" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("encryptRemoteSecrets", () => {
  it("encrypts typed secrets of a password connection", () => {
    const result = encryptRemoteSecrets(
      {
        typed: typedOf("password", { password: "pw", privateKey: "k" }),
        connectionId: "c",
        stored: STORED,
      },
      cipherOf(),
    );
    expect(result).toEqual({
      password: "enc(remote-ssh:c:password|pw)",
      privateKey: null,
      passphrase: null,
    });
  });

  it("keeps a stored password for an empty field", () => {
    const result = encryptRemoteSecrets(
      { typed: typedOf("password"), connectionId: "c", stored: STORED },
      cipherOf(),
    );
    expect(result.password).toBe("sp");
  });

  it("keeps stored secrets for empty fields", () => {
    const result = encryptRemoteSecrets(
      { typed: typedOf("key_passphrase"), connectionId: "c", stored: STORED },
      cipherOf(),
    );
    expect(result).toEqual({
      password: null,
      privateKey: "sk",
      passphrase: "ss",
    });
  });

  it("requires a secret of the method", () => {
    for (const stored of [null, { ...STORED, privateKey: null }])
      expect(() =>
        encryptRemoteSecrets(
          { typed: typedOf("key"), connectionId: "c", stored },
          cipherOf(),
        ),
      ).toThrow("remote_secret_required");
  });
});

describe("decryptRemoteCredentials", () => {
  it("decrypts stored secrets and registers them", () => {
    const credentials = decryptRemoteCredentials(
      {
        id: "c",
        authMethod: "key_passphrase",
        secrets: { password: null, privateKey: "k", passphrase: "p" },
      },
      cipherOf(),
    );
    expect(credentials).toEqual({
      method: "key_passphrase",
      password: null,
      privateKey: "dec(remote-ssh:c:private_key|k)",
      passphrase: "dec(remote-ssh:c:passphrase|p)",
    });
    expect(logging.registerLogSecret).toHaveBeenCalledTimes(2);
  });

  it("reports an undecryptable payload as a missing secret", () => {
    try {
      decryptRemoteCredentials(
        {
          id: "c",
          authMethod: "password",
          secrets: { password: "broken", privateKey: null, passphrase: null },
        },
        cipherOf(),
      );
      expect.unreachable();
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(RemoteError);
      expect((error as RemoteError).failure).toBe("secret_missing");
    }
    expect(logging.logCaughtError).toHaveBeenCalledOnce();
  });
});

describe("testRemoteCredentials", () => {
  const record = {
    id: "c",
    authMethod: "key" as const,
    secrets: { password: null, privateKey: "k", passphrase: null },
  };

  it("prefers typed secrets", () => {
    expect(
      testRemoteCredentials(
        typedOf("key_passphrase", { privateKey: "tk", passphrase: "tp" }),
        record,
        cipherOf(),
      ),
    ).toEqual({
      method: "key_passphrase",
      password: null,
      privateKey: "tk",
      passphrase: "tp",
    });
  });

  it("falls back to stored secrets", () => {
    expect(testRemoteCredentials(typedOf("key"), record, cipherOf())).toEqual({
      method: "key",
      password: null,
      privateKey: "dec(remote-ssh:c:private_key|k)",
      passphrase: null,
    });
  });

  it("falls back to a stored passphrase", () => {
    const stored = {
      id: "c",
      authMethod: "key_passphrase" as const,
      secrets: { password: null, privateKey: "k", passphrase: "p" },
    };
    expect(
      testRemoteCredentials(typedOf("key_passphrase"), stored, cipherOf())
        .passphrase,
    ).toBe("dec(remote-ssh:c:passphrase|p)");
  });

  it("has nothing to fall back to without a stored connection", () => {
    expect(
      testRemoteCredentials(
        typedOf("password", { password: "x" }),
        null,
        cipherOf(),
      ),
    ).toEqual({
      method: "password",
      password: "x",
      privateKey: null,
      passphrase: null,
    });
    expect(
      testRemoteCredentials(typedOf("password"), null, cipherOf()).password,
    ).toBeNull();
  });
});
