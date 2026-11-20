import { describe, expect, it } from "vitest";

import { classifyKeyFailure, classifySshFailure } from "./SshFailure";
import {
  hostKeyAlgorithms,
  isSameHostKey,
  knownHostsLine,
  parseHostKey,
  preferredHostKey,
} from "./SshHostKey";
import {
  connectArguments,
  multiplexArguments,
  promptSecret,
  quoteShellWord,
  sshEnvironment,
} from "./SshOptions";

import type { SshProcessResult } from "./SshProcess";
import type { SshTarget } from "./SshOptions";

const result: SshProcessResult = {
  exitCode: 255,
  stdout: "",
  stderr: "",
  isTimedOut: false,
  isUnavailable: false,
};
const blob = Buffer.concat([
  Buffer.from([0, 0, 0, 11]),
  Buffer.from("ssh-ed25519"),
  Buffer.from("key"),
]);
const encoded = blob.toString("base64");
const hostKey = {
  algorithm: "ssh-ed25519",
  key: encoded,
  fingerprint: "fingerprint",
};
const target: SshTarget = {
  alias: "server",
  host: "example.com",
  port: 22,
  username: "user",
  hostKey,
  credentials: {
    method: "password",
    password: "secret",
    privateKey: null,
    passphrase: null,
  },
};

describe("SSH failure classification", () => {
  it.each([
    ["Host key verification failed", "host_key_changed"],
    ["Could not resolve hostname", "host_unknown"],
    ["Connection refused", "unreachable_refused"],
    ["Network is unreachable", "unreachable_network"],
    ["bad passphrase", "passphrase_wrong"],
    ["invalid format", "key_invalid"],
    ["Connection timed out", "unreachable_timeout"],
    ["Connection reset", "transport_lost"],
    ["unknown", "remote_failed"],
  ])("classifies %s", (stderr, expected) => {
    expect(classifySshFailure({ ...result, stderr }, "password")).toBe(
      expected,
    );
  });

  it("distinguishes credentials, process failures and remote command exits", () => {
    expect(
      classifySshFailure(
        { ...result, stderr: "Permission denied" },
        "password",
      ),
    ).toBe("password_rejected");
    expect(
      classifySshFailure({ ...result, stderr: "Permission denied" }, "key"),
    ).toBe("key_rejected");
    expect(classifySshFailure({ ...result, isUnavailable: true }, "key")).toBe(
      "ssh_unavailable",
    );
    expect(classifySshFailure({ ...result, isTimedOut: true }, "key")).toBe(
      "unreachable_timeout",
    );
    expect(classifySshFailure({ ...result, exitCode: 1 }, "key")).toBeNull();
    expect(
      classifyKeyFailure({ ...result, stderr: "bad passphrase" }, "key"),
    ).toBe("passphrase_required");
    expect(
      classifyKeyFailure(
        { ...result, stderr: "bad passphrase" },
        "key_passphrase",
      ),
    ).toBe("passphrase_wrong");
    expect(classifyKeyFailure({ ...result, exitCode: 0 }, "key")).toBeNull();
    expect(classifyKeyFailure(result, "key")).toBe("key_invalid");
  });

  it("prioritizes unavailable processes and authentication failures", () => {
    expect(classifyKeyFailure({ ...result, isUnavailable: true }, "key")).toBe(
      "ssh_unavailable",
    );
    expect(
      classifySshFailure(
        { ...result, stderr: "Permission denied; Connection timed out" },
        "key_passphrase",
      ),
    ).toBe("key_rejected");
    expect(
      classifySshFailure(
        { ...result, stderr: "Unable to negotiate host key" },
        "key",
      ),
    ).toBe("host_key_changed");
  });
});

describe("SSH host key and options", () => {
  it("validates wire algorithm and selects supported keys", () => {
    const parsed = parseHostKey(`ssh-ed25519 ${encoded}`);
    expect(parsed?.algorithm).toBe(hostKey.algorithm);
    expect(parsed?.key).toBe(hostKey.key);
    expect(parsed?.fingerprint).toMatch(/^SHA256:/u);
    expect(parseHostKey(`ssh-rsa ${encoded}`)).toBeNull();
    expect(parseHostKey("ssh-ed25519 !!!")).toBeNull();
    expect(
      preferredHostKey(`# comment\nexample ssh-ed25519 ${encoded}\n`),
    ).toEqual(parsed);
    expect(preferredHostKey("example unsupported abc")).toBeNull();
    expect(isSameHostKey(hostKey, { ...hostKey, fingerprint: "other" })).toBe(
      true,
    );
    expect(isSameHostKey(hostKey, { ...hostKey, key: "other" })).toBe(false);
    expect(hostKeyAlgorithms({ ...hostKey, algorithm: "ssh-rsa" })).toBe(
      "rsa-sha2-512,rsa-sha2-256",
    );
    expect(hostKeyAlgorithms({ ...hostKey, algorithm: "unknown" })).toBe(
      "unknown",
    );
    expect(knownHostsLine("server", hostKey)).toBe(
      `server ssh-ed25519 ${encoded}\n`,
    );
  });

  it("isolates authentication and quotes shell words", () => {
    const files = { knownHosts: "/private/known_hosts", key: null };
    expect(connectArguments(target, files)).toContain(
      "PreferredAuthentications=password,keyboard-interactive",
    );
    expect(multiplexArguments(target, files, "/private/socket")).toContain(
      "PasswordAuthentication=no",
    );
    expect(promptSecret(target.credentials)).toBe("secret");
    expect(sshEnvironment("/private/askpass", null)).toMatchObject({
      LC_ALL: "C",
      SSH_ASKPASS: "/private/askpass",
    });
    expect(quoteShellWord("it's safe")).toBe("'it'\\''s safe'");
  });

  it("rejects malformed host keys and prefers stronger supported keys", () => {
    const rsaBlob = Buffer.concat([
      Buffer.from([0, 0, 0, 7]),
      Buffer.from("ssh-rsa"),
      Buffer.from("key"),
    ]);
    expect(parseHostKey("ssh-ed25519")).toBeNull();
    expect(parseHostKey("ssh-ed25519 YQ==")).toBeNull();
    expect(
      parseHostKey(`ssh-ed25519 ${rsaBlob.toString("base64")}`),
    ).toBeNull();
    expect(parseHostKey(`ssh-ed25519 ${"a".repeat(4097)}`)).toBeNull();
    expect(
      preferredHostKey(
        `server ssh-rsa ${rsaBlob.toString("base64")}\nserver ssh-ed25519 ${encoded}`,
      )?.algorithm,
    ).toBe("ssh-ed25519");
  });

  it("uses only the selected key and secret for key authentication", () => {
    const credentials = {
      ...target.credentials,
      method: "key_passphrase" as const,
      passphrase: "phrase",
    };
    const args = connectArguments(
      { ...target, credentials },
      { knownHosts: "/private/known_hosts", key: "/private/key" },
    );
    expect(args).toContain("PreferredAuthentications=publickey");
    expect(args).toContain("/private/key");
    expect(args).toContain("PasswordAuthentication=no");
    expect(
      connectArguments(
        { ...target, credentials },
        { knownHosts: "known", key: null },
      ),
    ).not.toContain("-i");
    expect(promptSecret(credentials)).toBe("phrase");
    expect(promptSecret({ ...credentials, method: "key" })).toBe("");
    expect(sshEnvironment("/private/askpass", "phrase")).toHaveProperty(
      "PAGES_SSH_SECRET",
      "phrase",
    );
  });

  it("uses a safe search path when the process has none", () => {
    const previous = process.env.PATH;
    try {
      delete process.env.PATH;
      expect(sshEnvironment("askpass", null).PATH).toBe("/usr/bin:/bin");
    } finally {
      if (previous === undefined) delete process.env.PATH;
      else process.env.PATH = previous;
    }
  });
});
