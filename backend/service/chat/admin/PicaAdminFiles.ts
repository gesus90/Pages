import { isUtf8 } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import {
  fstatSync,
  fsyncSync,
  ftruncateSync,
  readSync,
  writeSync,
} from "node:fs";
import { readdir } from "node:fs/promises";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { redactCredentials } from "@/backend/security/AgentTextSafety";

import { PicaAdminError } from "./PicaAdminContracts";
import {
  adminPathParts,
  openAdminDirectory,
  withAdminFile,
  requireAdminFileLocation,
} from "./PicaAdminPaths";

import type { FileHandle } from "node:fs/promises";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { PicaFileEdit } from "./PicaAdminContracts";

const MAXIMUM_BYTES = 64_000;
interface FileRevision {
  readonly scope: string;
  readonly path: string;
  readonly fingerprint: string;
  readonly expires: number;
}

/** Scope includes the server-owned job; knowing another person's revision never grants file access. */
export function adminScope(context: RuntimeExecutionContext): string {
  return JSON.stringify([context.userId, context.sessionId, context.runId]);
}

function fingerprint(file: FileHandle, bytes: Buffer): string {
  const facts = fstatSync(file.fd, { bigint: true });
  return createHash("sha256")
    .update(
      JSON.stringify([
        String(facts.dev),
        String(facts.ino),
        String(facts.mtimeNs),
        String(facts.ctimeNs),
      ]),
    )
    .update(bytes)
    .digest("hex");
}

function requireSafeContent(text: string): void {
  if (
    text.includes("\0") ||
    redactCredentials(text) !== text ||
    /-----BEGIN .*PRIVATE KEY|(?:password|secret|token|credential|api[_-]?key)["']?\s*[:=]/iu.test(
      text,
    )
  )
    throw new PicaAdminError("SECRET_DENIED");
}

function readBytes(file: FileHandle): Buffer {
  const facts = fstatSync(file.fd);
  if (!facts.isFile() || facts.nlink !== 1 || facts.size > MAXIMUM_BYTES)
    throw new PicaAdminError("FILE_DENIED");
  const bytes = Buffer.alloc(MAXIMUM_BYTES + 1);
  const length = readSync(file.fd, bytes, 0, bytes.length, 0);
  if (length > MAXIMUM_BYTES || !isUtf8(bytes.subarray(0, length)))
    throw new PicaAdminError("FILE_DENIED");
  const content = bytes.subarray(0, length);
  const text = content.toString("utf8");
  requireSafeContent(text);
  return content;
}

/** Bounded text access and read-before-edit optimistic concurrency in the explicit handover directory. */
export class PicaAdminFiles {
  private readonly revisions = new Map<string, FileRevision>();
  private readonly queue = new SerialQueue();

  /** Lists one directory without following links, reading contents or traversing recursively. */
  public async find(
    context: RuntimeExecutionContext,
    relative: string,
  ): Promise<unknown> {
    const directory = await openAdminDirectory(
      context.userId,
      adminPathParts(relative, true),
    );
    try {
      await context.authorize();
      context.signal.throwIfAborted();
      const entries = await readdir(`/proc/self/fd/${directory.fd}`, {
        withFileTypes: true,
      });
      return entries
        .filter(
          (entry) =>
            this.isAllowedEntry(entry.name, entry.isDirectory()) &&
            (entry.isFile() || entry.isDirectory()),
        )
        .slice(0, 100)
        .map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory() ? "directory" : "file",
        }));
    } finally {
      await directory.close();
    }
  }

  /** Reads current bytes and issues an expiring revision bound to this person and job. */
  public async read(
    context: RuntimeExecutionContext,
    relative: string,
  ): Promise<{ path: string; content: string; revision: string }> {
    return withAdminFile({
      userId: context.userId,
      relative,
      work: async (file) => {
        await context.authorize();
        context.signal.throwIfAborted();
        requireAdminFileLocation(file, context.userId, relative);
        const bytes = readBytes(file);
        const revision = randomUUID();
        for (const [key, entry] of this.revisions)
          if (entry.expires < Date.now()) this.revisions.delete(key);
        if (this.revisions.size >= 500)
          throw new PicaAdminError("RESOURCE_LIMIT");
        this.revisions.set(revision, {
          scope: adminScope(context),
          path: relative,
          fingerprint: fingerprint(file, bytes),
          expires: Date.now() + 600_000,
        });
        return { path: relative, content: bytes.toString("utf8"), revision };
      },
    });
  }

  /** Changes one unique passage only after a fresh read and authorization; conflicting revisions are consumed. */
  public async edit(
    context: RuntimeExecutionContext,
    input: PicaFileEdit,
    authorize: () => Promise<void>,
  ): Promise<unknown> {
    return this.queue.run(async () => {
      const revision = this.revisions.get(input.revision);
      this.revisions.delete(input.revision);
      if (
        !revision ||
        revision.scope !== adminScope(context) ||
        revision.path !== input.path ||
        revision.expires < Date.now()
      )
        throw new PicaAdminError("REVISION_REQUIRED");
      return withAdminFile({
        userId: context.userId,
        relative: input.path,
        isWritable: true,
        work: async (file) => {
          await authorize();
          context.signal.throwIfAborted();
          requireAdminFileLocation(file, context.userId, input.path);
          const bytes = readBytes(file);
          if (fingerprint(file, bytes) !== revision.fingerprint)
            throw new PicaAdminError("FILE_CONFLICT");
          const original = bytes.toString("utf8");
          if (
            !original.includes(input.before) ||
            original.indexOf(input.before) !==
              original.lastIndexOf(input.before)
          )
            throw new PicaAdminError("PASSAGE_NOT_UNIQUE");
          const updated = original.replace(input.before, () => input.after);
          if (Buffer.byteLength(updated) > MAXIMUM_BYTES)
            throw new PicaAdminError("FILE_DENIED");
          requireSafeContent(updated);
          // No await between comparison and commit: Pages writers cannot interleave this critical section.
          const output = Buffer.from(updated, "utf8");
          let written = 0;
          while (written < output.length)
            written += writeSync(
              file.fd,
              output,
              written,
              output.length - written,
              written,
            );
          ftruncateSync(file.fd, output.length);
          fsyncSync(file.fd);
          return { path: input.path, status: "edited", bytes: output.length };
        },
      });
    });
  }

  private isAllowedEntry(name: string, isDirectory: boolean): boolean {
    try {
      adminPathParts(name, isDirectory);
      return true;
    } catch {
      return false;
    }
  }
}
