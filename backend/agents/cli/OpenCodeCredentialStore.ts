import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  openCodeCredentialFile,
  readOpenCodeKey,
  requireOpenCodeCredentialDirectory,
} from "./OpenCodeCredentials";

import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { CliCredentialAccess, CliHome } from "./CliContracts";
import type { OpenCodeKeyInput } from "./OpenCodeCredentials";

function nativeCredential(input: OpenCodeKeyInput): string {
  return JSON.stringify({
    [input.modelProvider]: { type: "api", key: input.apiKey },
  });
}

function encryptedFile(home: CliHome): string {
  return path.join(
    path.dirname(openCodeCredentialFile(home)),
    "auth.pages.encrypted",
  );
}

async function readPrivateFile(file: string): Promise<string | null> {
  const facts = await lstat(file).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    logCaughtError("OpenCodeCredentialStore", error);
    throw new AgentError("cli_not_logged_in");
  });
  if (facts === null) return null;
  if (
    !facts.isFile() ||
    facts.isSymbolicLink() ||
    facts.size > 8_192 ||
    (facts.mode & 0o077) !== 0 ||
    (process.getuid && facts.uid !== process.getuid())
  )
    throw new AgentError("cli_not_logged_in");
  return readFile(file, {
    encoding: "utf8",
    flag: constants.O_RDONLY | constants.O_NOFOLLOW,
  });
}

/** Encrypts native credentials at rest and supplies them only to the isolated child environment. */
export class OpenCodeCredentialStore {
  private readonly cipher: InstanceSecretCipher | undefined;

  public constructor(cipher?: InstanceSecretCipher) {
    this.cipher = cipher;
  }

  /** Replaces exactly one provider key; successful replacement removes legacy plaintext. */
  public async store(home: CliHome, input: OpenCodeKeyInput): Promise<void> {
    if (!this.cipher) throw new AgentError("secret_unavailable");
    const content = nativeCredential(input);
    readOpenCodeKey(content);
    await mkdir(path.dirname(openCodeCredentialFile(home)), {
      recursive: true,
      mode: 0o700,
    });
    await requireOpenCodeCredentialDirectory(home);
    const pendingFile = `${encryptedFile(home)}.${randomUUID()}`;
    try {
      await writeFile(
        pendingFile,
        this.cipher.encrypt(path.basename(home.root), content),
        {
          mode: 0o600,
          flag:
            constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
        },
      );
      await rename(pendingFile, encryptedFile(home));
    } finally {
      await rm(pendingFile, { force: true });
    }
    await rm(openCodeCredentialFile(home), { force: true });
  }

  /** Reads one provider without reinterpretation; legacy native files remain usable. */
  public async access(home: CliHome): Promise<CliCredentialAccess> {
    await requireOpenCodeCredentialDirectory(home);
    const encrypted = await readPrivateFile(encryptedFile(home));
    let content: string | null;
    if (encrypted === null)
      content = await readPrivateFile(openCodeCredentialFile(home));
    else {
      if (!this.cipher) throw new AgentError("secret_unavailable");
      content = this.cipher.decrypt(path.basename(home.root), encrypted);
    }
    if (content === null) throw new AgentError("cli_not_logged_in");
    const input = readOpenCodeKey(content);
    const escapedKey = JSON.stringify(input.apiKey).slice(1, -1);
    return {
      modelProvider: input.modelProvider,
      environment: { OPENCODE_AUTH_CONTENT: nativeCredential(input) },
      redact: (text) =>
        text
          .replaceAll(escapedKey, "[redacted]")
          .replaceAll(input.apiKey, "[redacted]"),
    };
  }

  /** Removes both managed and legacy credentials without opening their contents. */
  public async remove(home: CliHome): Promise<void> {
    await rm(encryptedFile(home), { force: true });
    await rm(openCodeCredentialFile(home), { force: true });
  }
}
