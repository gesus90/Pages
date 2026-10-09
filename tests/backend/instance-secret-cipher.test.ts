import { createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";

describe("instance secret cipher", () => {
  const instanceKey = randomBytes(32);
  const cipher = new InstanceSecretCipher(instanceKey);

  it("round trips with fresh nonces, versioning, AAD and purpose-separated keys", () => {
    const encrypted = cipher.encrypt("connection", "marker-secret");
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain("marker-secret");
    expect(cipher.encrypt("connection", "marker-secret")).not.toBe(encrypted);
    expect(cipher.decrypt("connection", encrypted)).toBe("marker-secret");
    const [, nonce, ciphertext, tag] = encrypted.split(".");
    const derived = Buffer.from(
      hkdfSync(
        "sha256",
        instanceKey,
        "",
        "pages:agent-connection-secret:v1",
        32,
      ),
    );
    expect(derived.equals(instanceKey)).toBe(false);
    const rawDecipher = createDecipheriv(
      "aes-256-gcm",
      instanceKey,
      Buffer.from(nonce, "base64url"),
    );
    rawDecipher.setAAD(Buffer.from("agent-connection:connection"));
    rawDecipher.setAuthTag(Buffer.from(tag, "base64url"));
    rawDecipher.update(Buffer.from(ciphertext, "base64url"));
    expect(() => rawDecipher.final()).toThrow();
  });

  it("rejects relocation, key loss, tampering and malformed versions without leaking secrets", () => {
    const encrypted = cipher.encrypt("one", "marker-secret");
    expect(() => cipher.decrypt("two", encrypted)).toThrow(
      expect.objectContaining({ code: "secret_unavailable" }),
    );
    expect(() =>
      new InstanceSecretCipher(randomBytes(32)).decrypt("one", encrypted),
    ).toThrow();
    const segments = encrypted.split(".");
    segments[3] = Buffer.alloc(16).toString("base64url");
    for (const invalid of [
      segments.join("."),
      encrypted.replace("v1.", "v2."),
      "v1.a.b.c",
      "bad",
      "v1....",
      encrypted + ".extra",
    ]) {
      expect(() => cipher.decrypt("one", invalid)).toThrow(
        expect.objectContaining({ code: "secret_unavailable" }),
      );
    }
  });
});
