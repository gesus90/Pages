import { createHash } from "node:crypto";

import { expect, it, vi } from "vitest";

import { createAgentCredential, hashAgentCredential } from "./AgentCredential";
import {
  containsAgentBrowserSecret,
  redactAgentBrowserSecrets,
} from "./AgentBrowserSecrets";
import {
  redactCredentials,
  requireCredentialFreeText,
} from "./AgentTextSafety";
import { holdsNulCharacter } from "./IdentityText";
import { InstanceSecretCipher } from "./InstanceSecretCipher";
import {
  createUserCode,
  equalMcpDeviceHashes,
  hashMcpDeviceValue,
  isMcpDeviceCredential,
} from "./McpDeviceCredential";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

it("creates opaque agent credentials and hashes their exact contents", () => {
  const credential = createAgentCredential();
  expect(credential).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(createAgentCredential()).not.toBe(credential);
  expect(hashAgentCredential(credential)).toBe(
    createHash("sha256").update(credential).digest("hex"),
  );
});

it("masks browser material and leaves ordinary text unchanged", () => {
  const text =
    "pabs_example InBhYnNfYWJj /home/user/pages-agent-browser-private/file";
  expect(redactAgentBrowserSecrets(text)).toBe(
    "[redacted] [redacted] [redacted]",
  );
  expect(containsAgentBrowserSecret(text)).toBe(true);
  expect(containsAgentBrowserSecret("ordinary text")).toBe(false);
});

it("rejects recognizable credentials before forwarding text", () => {
  expect(redactCredentials("Bearer example-secret")).toBe("[redacted]");
  expect(redactCredentials("pabs_example")).toBe("[redacted]");
  expect(() => requireCredentialFreeText("hello")).not.toThrow();
  expect(() => requireCredentialFreeText("password=abcdefgh")).toThrow();
});

it("detects NUL characters at identity boundaries", () => {
  expect(holdsNulCharacter("alice")).toBe(false);
  expect(holdsNulCharacter("alice\u0000bob")).toBe(true);
});

it("validates device credential shape and separates hashes by purpose", () => {
  expect(createUserCode()).toMatch(/^[A-Z]{8}$/u);
  expect(isMcpDeviceCredential("a".repeat(43))).toBe(true);
  expect(isMcpDeviceCredential("a".repeat(42))).toBe(false);
  expect(isMcpDeviceCredential(null)).toBe(false);
  const hash = hashMcpDeviceValue("token", "value");
  const other = hashMcpDeviceValue("address", "value");
  expect(hash).not.toBe(other);
  expect(equalMcpDeviceHashes(hash, hash)).toBe(true);
  expect(equalMcpDeviceHashes(hash, other)).toBe(false);
  expect(equalMcpDeviceHashes(hash, "00")).toBe(false);
});

it("binds encrypted secrets to their connection and detects tampering", () => {
  const cipher = new InstanceSecretCipher(Buffer.alloc(32, 1));
  const payload = cipher.encrypt("connection", "secret");
  expect(cipher.encrypt("connection", "secret")).not.toBe(payload);
  expect(cipher.decrypt("connection", payload)).toBe("secret");
  expect(() => cipher.decrypt("other", payload)).toThrow();
  expect(() => cipher.decrypt("connection", "invalid")).toThrow();
  expect(() =>
    new InstanceSecretCipher(Buffer.alloc(32, 2)).decrypt(
      "connection",
      payload,
    ),
  ).toThrow();
});
