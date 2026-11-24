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
  OPENCODE_FREE_PROVIDER,
  ZAI_CODING_PLAN_PROVIDER,
} from "@/definition/AgentConnection";

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
 * The native providers a connection may list and run.
 * @param own - The one key selected for this connection, if any.
 * @returns OpenCode's free provider and the key's provider; only the key's
 * provider for a Z.AI Coding Plan key, whose connection is the subscription
 * alone and offers no free model beside it.
 */
function reachableProviders(own: OpenCodeKeyInput | null): string[] {
  if (own === null) return [OPENCODE_FREE_PROVIDER];
  if (own.modelProvider === ZAI_CODING_PLAN_PROVIDER)
    return [ZAI_CODING_PLAN_PROVIDER];
  return [...new Set([OPENCODE_FREE_PROVIDER, own.modelProvider])];
}

/**
 * Supplies the connection's own key and the public free provider to an isolated child.
 * @param own - The one key selected for this connection, if any.
 * @returns Process credentials and exact-secret redaction for that key only.
 */
export function openCodeCredentials(
  own: OpenCodeKeyInput | null,
): CliCredentialAccess {
  const keys = new Map<string, string>();
  if (own !== null) keys.set(own.modelProvider, own.apiKey);
  const secrets = [...keys.values()].flatMap((apiKey) => [
    JSON.stringify(apiKey).slice(1, -1),
    apiKey,
  ]);
  return {
    modelProviders: reachableProviders(own),
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
    secrets,
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
