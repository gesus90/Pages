import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { logCaughtError } from "@/backend/logging/Logger";

import { PicaAdminError } from "../admin/PicaAdminContracts";

import type { PicaBrowserStorageState } from "./PicaBrowserSession";

const CIPHER = "aes-256-gcm";
const MAXIMUM_SESSIONS_PER_PERSON = 20;
const MAXIMUM_STATE_BYTES = 1024 * 1024;
const USER_DIRECTORY = /^[\w-]{1,100}$/u;

const stateSchema = z.object({
  cookies: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      domain: z.string(),
      path: z.string(),
      expires: z.number(),
      httpOnly: z.boolean(),
      secure: z.boolean(),
      sameSite: z.enum(["Strict", "Lax", "None"]),
    }),
  ),
  origins: z.array(
    z.object({
      origin: z.string(),
      localStorage: z.array(z.object({ name: z.string(), value: z.string() })),
    }),
  ),
});

const envelopeSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  origins: z.array(z.string()),
  savedAt: z.string(),
  nonce: z.string(),
  ciphertext: z.string(),
  tag: z.string(),
});

/** A saved session as the person sees it: a name and the sites it holds, never its cookies. */
export interface PicaSavedBrowserSession {
  readonly name: string;
  readonly origins: readonly string[];
  readonly savedAt: string;
}

function fileNameOf(name: string): string {
  return `${createHash("sha256").update(name).digest("hex").slice(0, 40)}.json`;
}

function originsOf(state: PicaBrowserStorageState): string[] {
  const origins = new Set<string>();
  for (const entry of state.origins) origins.add(entry.origin);
  for (const cookie of state.cookies)
    origins.add(
      `${cookie.secure ? "https" : "http"}://${cookie.domain.replace(/^\./u, "")}`,
    );
  return [...origins].slice(0, 20);
}

/**
 * Keeps the sessions an administrator released for Pica, encrypted on the server.
 *
 * @remarks
 * A saved session is the cookies and local storage of an isolated browser the
 * administrator signed in to. It is stored per person, encrypted with a key
 * derived from the instance key and bound to the person and the name, and it
 * only ever goes back into a new isolated browser of the same person. No tool
 * result, log entry or screenshot carries it.
 */
export class PicaBrowserSessionStore {
  private readonly directory: string;
  private readonly key: Buffer;

  /**
   * Creates the store.
   *
   * @param directory - Where the encrypted files live, next to the database.
   * @param instanceKey - The instance key the encryption key derives from.
   */
  public constructor(directory: string, instanceKey: Buffer) {
    this.directory = directory;
    this.key = Buffer.from(
      hkdfSync("sha256", instanceKey, "", "pages:pica-browser-session:v1", 32),
    );
  }

  /** Lists the names and sites of a person's saved sessions. */
  public async list(
    userId: string,
  ): Promise<readonly PicaSavedBrowserSession[]> {
    const directory = this.personDirectory(userId);
    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      return [];
    }
    const sessions: PicaSavedBrowserSession[] = [];
    for (const fileName of names) {
      const envelope = await this.readEnvelope(path.join(directory, fileName));
      if (envelope)
        sessions.push({
          name: envelope.name,
          origins: envelope.origins,
          savedAt: envelope.savedAt,
        });
    }
    return sessions.sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * Saves the state of a browser under a name; an existing name is replaced.
   *
   * @param userId - The person who owns it.
   * @param name - The validated session name.
   * @param state - Cookies and local storage of the browser.
   * @returns The listing entry.
   * @throws {PicaAdminError} `RESOURCE_LIMIT` for too many or too large sessions.
   */
  public async save(
    userId: string,
    name: string,
    state: PicaBrowserStorageState,
  ): Promise<PicaSavedBrowserSession> {
    const directory = this.personDirectory(userId);
    const plain = Buffer.from(JSON.stringify(state), "utf8");
    if (plain.length > MAXIMUM_STATE_BYTES)
      throw new PicaAdminError("RESOURCE_LIMIT");
    const existing = await this.list(userId);
    if (
      existing.length >= MAXIMUM_SESSIONS_PER_PERSON &&
      !existing.some((entry) => entry.name === name)
    )
      throw new PicaAdminError("RESOURCE_LIMIT");
    const nonce = randomBytes(12);
    const cipher = createCipheriv(CIPHER, this.key, nonce);
    cipher.setAAD(this.associatedData(userId, name));
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const entry: PicaSavedBrowserSession = {
      name,
      origins: originsOf(state),
      savedAt: new Date().toISOString(),
    };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const target = path.join(directory, fileNameOf(name));
    const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(
      temporary,
      JSON.stringify({
        version: 1,
        ...entry,
        nonce: nonce.toString("base64url"),
        ciphertext: ciphertext.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
      }),
      { mode: 0o600 },
    );
    await rename(temporary, target);
    return entry;
  }

  /**
   * Reads and decrypts a saved session of the person.
   *
   * @param userId - The person who owns it.
   * @param name - The session name.
   * @returns The cookies and local storage.
   * @throws {PicaAdminError} `SESSION_NOT_FOUND` for an unknown, foreign or damaged session.
   */
  public async read(
    userId: string,
    name: string,
  ): Promise<PicaBrowserStorageState> {
    const envelope = await this.readEnvelope(
      path.join(this.personDirectory(userId), fileNameOf(name)),
    );
    if (!envelope || envelope.name !== name)
      throw new PicaAdminError("SESSION_NOT_FOUND");
    try {
      const decipher = createDecipheriv(
        CIPHER,
        this.key,
        Buffer.from(envelope.nonce, "base64url"),
      );
      decipher.setAAD(this.associatedData(userId, name));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
        decipher.final(),
      ]);
      const parsed: unknown = JSON.parse(plain.toString("utf8"));
      return stateSchema.parse(parsed);
    } catch (error: unknown) {
      logCaughtError("PicaBrowserSessionStore", error);
      throw new PicaAdminError("SESSION_NOT_FOUND");
    }
  }

  /** Deletes a saved session; an unknown name is not an error. */
  public async remove(userId: string, name: string): Promise<void> {
    await rm(path.join(this.personDirectory(userId), fileNameOf(name)), {
      force: true,
    });
  }

  private personDirectory(userId: string): string {
    if (!USER_DIRECTORY.test(userId))
      throw new PicaAdminError("SESSION_DENIED");
    return path.join(this.directory, userId);
  }

  private associatedData(userId: string, name: string): Buffer {
    return Buffer.from(`pica-browser-session:${userId}:${name}`);
  }

  private async readEnvelope(
    file: string,
  ): Promise<z.infer<typeof envelopeSchema> | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
      return envelopeSchema.parse(parsed);
    } catch {
      return null;
    }
  }
}
