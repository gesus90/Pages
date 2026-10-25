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
import { OPENCODE_FREE_PROVIDER } from "@/definition/AgentConnection";

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

/**
 * Combines OpenCode's free provider, the connection's own key and the keys
 * Pages links, without letting a linked key replace the connection's own.
 *
 * @param own - The key stored with the connection, if any.
 * @param linked - The keys of the linked API connections.
 * @returns Process credentials that hand each child one provider's key only.
 */
export function openCodeCredentials(
  own: OpenCodeKeyInput | null,
  linked: readonly OpenCodeKeyInput[],
): CliCredentialAccess {
  const keys = new Map<string, string>();
  for (const key of linked) keys.set(key.modelProvider, key.apiKey);
  if (own !== null) keys.set(own.modelProvider, own.apiKey);
  const secrets = [...keys.values()].flatMap((apiKey) => [
    JSON.stringify(apiKey).slice(1, -1),
    apiKey,
  ]);
  return {
    modelProviders: [...new Set([OPENCODE_FREE_PROVIDER, ...keys.keys()])],
    ownProvider: own?.modelProvider ?? null,
    environmentFor: (modelProvider): Readonly<Record<string, string>> => {
      const apiKey = keys.get(modelProvider);
      if (apiKey === undefined) return {};
      return {
        OPENCODE_AUTH_CONTENT: nativeCredential({ modelProvider, apiKey }),
      };
    },
    redact: (text) =>
      secrets.reduce(
        (redacted, secret) => redacted.replaceAll(secret, "[redacted]"),
        text,
      ),
  };
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

  /**
   * Reads the key stored with this connection, if it has one.
   *
   * @remarks
   * One provider without reinterpretation; legacy native files remain usable.
   */
  public async readOwn(home: CliHome): Promise<OpenCodeKeyInput | null> {
    await requireOpenCodeCredentialDirectory(home);
    const encrypted = await readPrivateFile(encryptedFile(home));
    let content: string | null;
    if (encrypted === null)
      content = await readPrivateFile(openCodeCredentialFile(home));
    else {
      if (!this.cipher) throw new AgentError("secret_unavailable");
      content = this.cipher.decrypt(path.basename(home.root), encrypted);
    }
    return content === null ? null : readOpenCodeKey(content);
  }

  /** Removes both managed and legacy credentials without opening their contents. */
  public async remove(home: CliHome): Promise<void> {
    await rm(encryptedFile(home), { force: true });
    await rm(openCodeCredentialFile(home), { force: true });
  }
}
