import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createAgentCredential,
  hashAgentCredential,
} from "@/backend/security/AgentCredential";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { SetupToken } from "@/backend/runtime/SetupToken";

describe("agent credentials", () => {
  it("creates distinct URL-safe credentials of full entropy", () => {
    const first = createAgentCredential();
    const second = createAgentCredential();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(second).not.toBe(first);
  });

  it("persists only a stable SHA-256 digest that differs from the credential", () => {
    const credential = createAgentCredential();
    const digest = hashAgentCredential(credential);

    expect(digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(digest).not.toContain(credential);
    expect(hashAgentCredential(credential)).toBe(digest);
    expect(hashAgentCredential(`${credential}x`)).not.toBe(digest);
  });
});

describe("InstanceSecretCipher", () => {
  const cipher = new InstanceSecretCipher(randomBytes(32));

  it("round-trips a secret bound to its connection", () => {
    const payload = cipher.encrypt("connection-1", "sk-secret ✓");

    expect(payload).toMatch(/^v1\.[\w-]{16}\.[\w-]+\.[\w-]{22}$/u);
    expect(payload).not.toContain("sk-secret");
    expect(cipher.decrypt("connection-1", payload)).toBe("sk-secret ✓");
  });

  it("uses a fresh nonce for equal secrets", () => {
    expect(cipher.encrypt("c", "same")).not.toBe(cipher.encrypt("c", "same"));
  });

  it("refuses a payload moved to another connection", () => {
    const payload = cipher.encrypt("connection-1", "secret");

    expect(() => cipher.decrypt("connection-2", payload)).toThrow(
      expect.objectContaining({ code: "secret_unavailable" }),
    );
  });

  it("refuses payloads encrypted with another instance key", () => {
    const payload = new InstanceSecretCipher(randomBytes(32)).encrypt("c", "s");

    expect(() => cipher.decrypt("c", payload)).toThrow(
      expect.objectContaining({ code: "secret_unavailable" }),
    );
  });

  it("refuses tampered, truncated and unknown-version payloads", () => {
    const payload = cipher.encrypt("c", "secret");
    const [version, nonce, body, tag] = payload.split(".");
    const flipped = `${body.startsWith("A") ? "B" : "A"}${body.slice(1)}`;

    for (const candidate of [
      [version, nonce, flipped, tag].join("."),
      [version, nonce, body].join("."),
      ["v2", nonce, body, tag].join("."),
      "",
      "not a payload",
    ]) {
      expect(() => cipher.decrypt("c", candidate)).toThrow(
        expect.objectContaining({ code: "secret_unavailable" }),
      );
    }
  });
});

describe("SetupToken", () => {
  it("matches only its own secret", () => {
    const token = SetupToken.create();

    expect(token.value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(token.matches(token.value)).toBe(true);
    expect(token.matches(`${token.value}x`)).toBe(false);
    expect(token.matches(token.value.slice(1))).toBe(false);
    expect(SetupToken.create().matches(token.value)).toBe(false);
  });

  it.each([undefined, null, "", 42, {}, ["a"]])(
    "rejects the untrusted value %j",
    (candidate) => {
      expect(SetupToken.create().matches(candidate)).toBe(false);
    },
  );
});
