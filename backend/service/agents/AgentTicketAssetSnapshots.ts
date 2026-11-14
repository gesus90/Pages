import { createHash, randomUUID } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { AgentError } from "@/backend/error/AgentErrors";
import { logEvent } from "@/backend/logging/Logger";
import {
  digestStream,
  StreamTooLargeError,
} from "@/backend/storage/StreamDigest";

import { assetRepresentation } from "./AgentAssetRepresentations";
import { STREAMED_ASSET_REASON } from "./AgentTicketAssetService";
import { reportTicketAssetChanges } from "./AgentTicketAssetReferences";

import type { Stats } from "node:fs";
import type {
  AgentTicketAsset,
  AgentTicketAssetContent,
  AgentTicketAssetSnapshot,
  AgentTicketInput,
} from "@/definition/AgentTicketParameter";
import type {
  AgentTicketAssetBytes,
  AgentTicketAssetStream,
} from "./AgentTicketAssetService";

type SnapshotOriginal = Pick<
  AgentTicketAssetContent,
  "fileName" | "bytes" | "open"
> & {
  readonly original: AgentTicketAssetSnapshot["original"];
};

/** Private, content-addressed originals retained independently of mutable ticket attachments. */
export class AgentTicketAssetSnapshots {
  private readonly directory: string;
  private readonly notices = new WeakMap<object, string>();
  private readonly referenceNotices = new WeakMap<object, string>();

  public constructor(dataDirectory: string) {
    this.directory = path.join(dataDirectory, "ticket-asset-snapshots");
  }

  /** Captures a measured original before the run starts; identical versions share one private copy. */
  public async pin(
    file: SnapshotOriginal,
    asset?: AgentTicketAsset,
  ): Promise<AgentTicketAssetSnapshot> {
    try {
      return await this.pinOriginal(file, asset);
    } catch (error: unknown) {
      throw snapshotFailure(error, asset);
    }
  }

  /** Verifies the saved copy and derives bounded model content without reading the current attachment. */
  public async read(
    snapshot: AgentTicketAssetSnapshot,
    inlineBytes: number,
    asset?: AgentTicketAsset,
  ): Promise<AgentTicketAssetBytes | AgentTicketAssetStream> {
    try {
      return await this.readOriginal(snapshot, inlineBytes, asset);
    } catch (error: unknown) {
      throw snapshotFailure(error, asset);
    }
  }

  /** Emits one calm run-log line for each observed change, without using current originals as input. */
  public async reportChanges(
    input: AgentTicketInput,
    current: readonly AgentTicketAsset[],
    readDigest?: (asset: AgentTicketAsset) => Promise<string>,
  ): Promise<void> {
    const references = JSON.stringify(current);
    if (!readDigest) {
      if (this.referenceNotices.get(input.ticket) === references) return;
      this.referenceNotices.set(input.ticket, references);
      reportTicketAssetChanges(input.ticket.assets, current);
      return;
    }
    const changed: string[] = [];
    for (const asset of current) {
      const key = `${asset.source}:${asset.id}`;
      const expected = input.snapshots?.[key];
      if (!expected) continue;
      try {
        if ((await readDigest(asset)) !== expected.original.digest)
          changed.push(key);
      } catch {
        // A removed original no longer has to be readable; its private copy and owner rights do.
        changed.push(key);
      }
    }
    const signature = JSON.stringify([current, changed]);
    const basis = input.ticket;
    if (this.notices.get(basis) === signature) return;
    this.notices.set(basis, signature);
    const hasReportedReferences =
      this.referenceNotices.get(basis) === references;
    this.referenceNotices.set(basis, references);
    reportTicketAssetChanges(
      hasReportedReferences ? current : input.ticket.assets,
      current,
      changed,
    );
  }

  /** Reopens only an intact private copy; missing copies are never rebuilt from changed originals. */
  public async open(
    snapshot: AgentTicketAssetSnapshot,
    asset?: AgentTicketAsset,
  ): Promise<Readable> {
    try {
      await this.requireDirectory();
      const location = this.location(snapshot);
      const measured = await this.verify(snapshot);
      // digestStream destroys its stream and can close its FileHandle on Node 24.
      const file = await open(
        location,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const reopened = await file.stat();
        if (
          !reopened.isFile() ||
          reopened.dev !== measured.dev ||
          reopened.ino !== measured.ino ||
          reopened.size !== measured.size
        )
          throw new AgentError("parameter_ticket_changed");
        return file.createReadStream({
          start: 0,
          end: snapshot.original.size,
          autoClose: true,
        });
      } catch (error: unknown) {
        await file.close();
        throw error;
      }
    } catch (error: unknown) {
      throw snapshotFailure(error, asset);
    }
  }

  private async pinOriginal(
    file: SnapshotOriginal,
    asset?: AgentTicketAsset,
  ): Promise<AgentTicketAssetSnapshot> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.requireDirectory();
    const snapshot = { fileName: file.fileName, original: file.original };
    const target = this.location(snapshot);
    try {
      await lstat(target);
    } catch (error: unknown) {
      if (!isMissing(error)) throw error;
      await this.write(file, target);
    }
    const checked = await this.open(snapshot, asset);
    checked.destroy();
    return snapshot;
  }

  private async readOriginal(
    snapshot: AgentTicketAssetSnapshot,
    inlineBytes: number,
    asset?: AgentTicketAsset,
  ): Promise<AgentTicketAssetBytes | AgentTicketAssetStream> {
    const stream = await this.open(snapshot, asset);
    const file = { ...snapshot, size: snapshot.original.size };
    if (file.size > inlineBytes) {
      stream.destroy();
      return {
        ...file,
        content: { type: "file", reason: STREAMED_ASSET_REASON },
        open: () => this.open(snapshot, asset),
      };
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      if (!Buffer.isBuffer(chunk))
        throw new AgentError("parameter_ticket_changed");
      size += chunk.length;
      if (size > snapshot.original.size)
        throw new AgentError("parameter_ticket_changed");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (
      size !== snapshot.original.size ||
      createHash("sha256").update(bytes).digest("hex") !==
        snapshot.original.digest
    )
      throw new AgentError("parameter_ticket_changed");
    return { ...file, bytes, ...(await assetRepresentation(bytes)) };
  }

  private async verify(snapshot: AgentTicketAssetSnapshot): Promise<Stats> {
    const location = this.location(snapshot);
    const file = await open(
      location,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const before = await file.stat();
      if (!before.isFile() || before.size !== snapshot.original.size)
        throw new AgentError("parameter_ticket_changed");
      const measured = await digestStream(
        file.createReadStream({ autoClose: true }),
        snapshot.original.size,
      );
      const after = await lstat(location);
      if (
        measured.digest !== snapshot.original.digest ||
        measured.size !== snapshot.original.size ||
        !after.isFile() ||
        after.isSymbolicLink() ||
        after.ino !== before.ino ||
        after.dev !== before.dev ||
        after.size !== before.size
      )
        throw new AgentError("parameter_ticket_changed");
      return before;
    } finally {
      await file.close();
    }
  }

  private async write(file: SnapshotOriginal, target: string): Promise<void> {
    const pending = path.join(this.directory, `.${randomUUID()}.pending`);
    const hash = createHash("sha256");
    let size = 0;
    const counting = new Transform({
      transform(chunk: Buffer, encoding, done): void {
        size += chunk.length;
        if (size > file.original.size) {
          done(new AgentError("parameter_ticket_changed"));
          return;
        }
        hash.update(chunk);
        done(null, chunk);
      },
    });
    try {
      const source = file.bytes
        ? Readable.from([file.bytes])
        : await file.open?.();
      if (!source) throw new AgentError("parameter_asset_transfer_unsupported");
      await pipeline(
        source,
        counting,
        createWriteStream(pending, { mode: 0o600, flags: "wx" }),
      );
      if (
        size !== file.original.size ||
        hash.digest("hex") !== file.original.digest
      )
        throw new AgentError("parameter_ticket_changed");
      await this.sync(pending);
      await rename(pending, target);
      await this.sync(this.directory);
    } catch (error: unknown) {
      await rm(pending, { force: true });
      throw error;
    }
  }

  private async sync(location: string): Promise<void> {
    const file = await open(
      location,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      await file.sync();
    } finally {
      await file.close();
    }
  }

  private location(snapshot: AgentTicketAssetSnapshot): string {
    if (!/^[a-f0-9]{64}$/u.test(snapshot.original.digest))
      throw new AgentError("parameter_ticket_changed");
    return path.join(this.directory, snapshot.original.digest);
  }

  private async requireDirectory(): Promise<void> {
    const directory = await lstat(this.directory);
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new AgentError("parameter_ticket_changed");
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

function snapshotFailure(error: unknown, asset?: AgentTicketAsset): AgentError {
  if (error instanceof AgentError) return error;
  if (error instanceof StreamTooLargeError)
    return new AgentError("parameter_ticket_changed");
  logEvent({
    level: "error",
    event: "agent.ticket_assets.snapshot_io_failed",
    component: "AgentTicketAssetSnapshots",
    message: `Snapshot I/O failed for attachment ${asset?.id ?? "unknown"}`,
    metadata: { source: asset?.source },
    error,
  });
  return new AgentError("parameter_asset_unavailable");
}
