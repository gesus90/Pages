import { expect, it } from "vitest";

import {
  connectArguments,
  multiplexArguments,
  promptSecret,
  quoteShellWord,
  sshEnvironment,
} from "@/backend/remote/SshOptions";
import { SSH_SECRET_VARIABLE } from "@/backend/remote/SshRuntimeDirectory";

import type { SshCredentials, SshTarget } from "@/backend/remote/SshOptions";

const credentials: SshCredentials = {
  method: "password",
  password: "password",
  privateKey: null,
  passphrase: null,
};
const target: SshTarget = {
  alias: "pinned",
  host: "example.invalid",
  port: 2222,
  username: "alice",
  hostKey: { algorithm: "ssh-rsa", key: "key", fingerprint: "fingerprint" },
  credentials,
};
const files = { knownHosts: "/private/known_hosts", key: "/private/key" };

it("restricts each sign-in to the pinned host key and selected authentication method", () => {
  const password = connectArguments(target, files);
  expect(password).toContain("StrictHostKeyChecking=yes");
  expect(password).toContain("HostKeyAlgorithms=rsa-sha2-512,rsa-sha2-256");
  expect(password).toContain(
    "PreferredAuthentications=password,keyboard-interactive",
  );
  expect(password).not.toContain("/private/key");
  const key = connectArguments(
    { ...target, credentials: { ...credentials, method: "key" } },
    files,
  );
  expect(key).toContain("/private/key");
  expect(key).toContain("PasswordAuthentication=no");
  const multiplex = multiplexArguments(target, files, "/private/socket");
  expect(multiplex).toContain("/private/socket");
  expect(multiplex).toContain("BatchMode=yes");
  expect(multiplex).toContain("PubkeyAuthentication=no");
});

it("limits askpass secrets and quotes shell words", () => {
  expect(promptSecret(credentials)).toBe("password");
  expect(
    promptSecret({
      ...credentials,
      method: "key_passphrase",
      passphrase: "phrase",
    }),
  ).toBe("phrase");
  expect(promptSecret({ ...credentials, method: "key" })).toBe("");
  expect(sshEnvironment("/askpass", null)).not.toHaveProperty(
    SSH_SECRET_VARIABLE,
  );
  expect(sshEnvironment("/askpass", "phrase")).toHaveProperty(
    SSH_SECRET_VARIABLE,
    "phrase",
  );
  expect(quoteShellWord("a'b")).toBe("'a'\\''b'");
});
