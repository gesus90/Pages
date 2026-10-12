import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { readInstanceUrl } from "./instance-address.js";

/** Credentials belong to exactly one normalized instance and operating-system user. */
export interface StoredCredential {
  readonly tokenId: string;
  readonly token: string;
  readonly name: string;
  readonly expiresAt: number | null;
  readonly pairedAt: number;
}

/** Fixed, safe diagnostic for local persistence failures. */
export class CredentialStoreError extends Error {
  public constructor(
    message = "Could not use credentials.json. Check its directory (0700) and file (0600) permissions.",
  ) {
    super(message);
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isExisting(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

/** Validates persisted or device-issued credentials without trusting arbitrary JSON. */
export function isStoredCredential(input: unknown): input is StoredCredential {
  if (typeof input !== "object" || input === null) return false;
  return (
    hasCredentialIdentity(input) &&
    "expiresAt" in input &&
    (input.expiresAt === null ||
      (typeof input.expiresAt === "number" &&
        Number.isSafeInteger(input.expiresAt))) &&
    "pairedAt" in input &&
    typeof input.pairedAt === "number" &&
    Number.isSafeInteger(input.pairedAt)
  );
}

function hasCredentialIdentity(input: object): boolean {
  return (
    "tokenId" in input &&
    typeof input.tokenId === "string" &&
    input.tokenId.length > 0 &&
    "token" in input &&
    typeof input.token === "string" &&
    /^[A-Za-z0-9._~+/-]+=*$/.test(input.token) &&
    "name" in input &&
    typeof input.name === "string" &&
    input.name.length > 0 &&
    input.name.length <= 100
  );
}

/** Resolves the platform configuration location; no Pages production directory is used. */
export function credentialDirectory(
  environment: Readonly<Record<string, string | undefined>>,
  platform = process.platform,
): string {
  if (platform === "win32") {
    if (!environment.APPDATA || !path.isAbsolute(environment.APPDATA))
      throw new CredentialStoreError();
    return path.join(environment.APPDATA, "pages-mcp");
  }
  if (platform === "darwin")
    return path.join(homedir(), "Library", "Application Support", "pages-mcp");
  const root = environment.XDG_CONFIG_HOME ?? path.join(homedir(), ".config");
  if (!path.isAbsolute(root)) throw new CredentialStoreError();
  return path.join(root, "pages-mcp");
}

/** Private, atomic credential storage with a cross-process exclusive lock. */
export class CredentialStore {
  private readonly directory: string;
  private readonly filename: string;

  public constructor(
    environment: Readonly<Record<string, string | undefined>>,
  ) {
    this.directory = credentialDirectory(environment);
    this.filename = path.join(this.directory, "credentials.json");
  }

  /** Reads only the requested instance; rejects broad permissions and symbolic links. */
  public async get(instance: URL): Promise<StoredCredential | null> {
    return (await this.read())[instance.href] ?? null;
  }

  /** Serializes a read-modify-write operation, including any credential rotation. */
  public async update<Result>(
    instance: URL,
    operation: (
      current: StoredCredential | null,
    ) => Promise<{ credential: StoredCredential | null; result: Result }>,
  ): Promise<Result> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.assertPrivate(this.directory, true);
    const release = await this.lock();
    try {
      const credentials = await this.read();
      const next = await operation(credentials[instance.href] ?? null);
      if (next.credential) credentials[instance.href] = next.credential;
      else delete credentials[instance.href];
      await this.write(credentials);
      return next.result;
    } finally {
      await release();
    }
  }

  private async assertPrivate(
    filename: string,
    isDirectory: boolean,
  ): Promise<void> {
    const facts = await lstat(filename);
    if (
      facts.isSymbolicLink() ||
      (isDirectory ? !facts.isDirectory() : !facts.isFile())
    )
      throw new CredentialStoreError();
    if (
      process.platform !== "win32" &&
      ((facts.mode & 0o777) !== (isDirectory ? 0o700 : 0o600) ||
        facts.uid !== process.getuid?.())
    )
      throw new CredentialStoreError();
  }

  private async read(): Promise<Record<string, StoredCredential>> {
    try {
      await this.assertPrivate(this.directory, true);
      await this.assertPrivate(this.filename, false);
      const input: unknown = JSON.parse(await readFile(this.filename, "utf8"));
      if (typeof input !== "object" || input === null || Array.isArray(input))
        throw new CredentialStoreError();
      const credentials: Record<string, StoredCredential> = {};
      for (const [instance, credential] of Object.entries(input)) {
        if (
          !isStoredCredential(credential) ||
          readInstanceUrl(instance).href !== instance
        )
          throw new CredentialStoreError();
        credentials[instance] = credential;
      }
      return credentials;
    } catch (error: unknown) {
      if (isMissing(error)) return {};
      throw new CredentialStoreError();
    }
  }

  private async lock(): Promise<() => Promise<void>> {
    const lockPath = path.join(this.directory, "credentials.lock");
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const handle = await open(
          lockPath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
          0o600,
        );
        return async () => {
          await handle.close();
          await unlink(lockPath);
        };
      } catch (error: unknown) {
        if (!isExisting(error)) throw new CredentialStoreError();
        await delay(100);
      }
    }
    throw new CredentialStoreError(
      "credentials.json is locked. Finish the other pairing or rotation; remove credentials.lock only if no Pages MCP process is running.",
    );
  }

  private async write(
    credentials: Readonly<Record<string, StoredCredential>>,
  ): Promise<void> {
    const temporaryPath = path.join(
      this.directory,
      `credentials-${randomUUID()}.tmp`,
    );
    const handle = await open(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    try {
      await handle.writeFile(JSON.stringify(credentials));
      await handle.sync();
      await handle.close();
      await rename(temporaryPath, this.filename);
    } catch (error: unknown) {
      await handle.close();
      await unlink(temporaryPath);
      throw error;
    }
  }
}
