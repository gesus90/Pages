import { createHash } from "node:crypto";

import { AgentAssetError } from "@/backend/error/AgentAssetError";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  digestStream,
  StreamTooLargeError,
} from "@/backend/storage/StreamDigest";
import { detectTicketFileType } from "@/backend/storage/TicketFileType";
import { PLAN_HANDOVER_LIMITS } from "@/definition/AgentPlanHandover";

import { assetRepresentation } from "./AgentAssetRepresentations";
import { ticketAssetReferences } from "./AgentTicketAssetReferences";

import type { Readable } from "node:stream";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { User } from "@/definition/User";
import type { PlanAssetService } from "./assets/PlanAssetService";
import type {
  AgentTicketAsset,
  AgentTicketAssetContent,
} from "@/definition/AgentTicketParameter";

interface OpenedAsset {
  readonly fileName: string;
  readonly size: number;
  readonly stream: Readable;
}

interface OpenedAttachment {
  readonly attachment: Pick<OpenedAsset, "fileName" | "size">;
  readonly stream: Readable;
}

/** Existing file services remain the authority for each referenced file. */
export interface AgentTicketAssetDependencies {
  readonly tickets: {
    readonly list: (
      actor: User,
      ticketId: string,
    ) => Promise<readonly { readonly id: string }[]>;
    readonly open: (actor: User, id: string) => Promise<OpenedAttachment>;
  };
  readonly wiki: {
    readonly openAttachment: (
      actor: User,
      id: string,
    ) => Promise<OpenedAttachment>;
  };
  readonly assets: {
    readonly open: (actor: User, id: string) => Promise<OpenedAsset>;
  };
  /** The files of asset nodes (PAGE-268), read with the plan's project rights. */
  readonly plans?: PlanAssetService;
}

/** Bounded per transmission; exceeding the limit fails instead of truncating. */
export const MAX_TICKET_ASSET_BYTES = 10 * 1024 * 1024;

/** What is known of a file Pages read for a transmission. */
export interface AgentTicketAssetFile {
  readonly fileName: string;
  readonly content: AgentTicketAssetContent["content"];
  readonly original: NonNullable<AgentTicketAssetContent["original"]>;
  readonly size: number;
}

/** A file small enough to be held and offered to the model as a whole. */
export interface AgentTicketAssetBytes extends AgentTicketAssetFile {
  readonly bytes: Buffer;
}

/**
 * A file read as a stream: length and digest are measured, its bytes are not kept.
 *
 * @remarks
 * Such a file reaches an agent as an original file only. `open` reads it again
 * under the live rights of the person, so a handover copies it chunk by chunk.
 */
export interface AgentTicketAssetStream extends AgentTicketAssetFile {
  readonly open: () => Promise<Readable>;
}

/** What a streamed file was measured as, kept so a plan check does not read it again. */
interface MeasuredAsset {
  readonly digest: string;
  readonly mimeType: string;
}

/** How many measurements are kept; the oldest is dropped first. */
const MEASURED_ASSET_ENTRIES = 256;

/** Why a file is handed over as a file only, without model content. */
export const STREAMED_ASSET_REASON = "too-large-for-model";

/** Discovers ticket attachments and opens every reference through its original access policy. */
export class AgentTicketAssetService {
  private readonly dependencies: AgentTicketAssetDependencies;
  private readonly measured = new Map<string, MeasuredAsset>();

  public constructor(dependencies: AgentTicketAssetDependencies) {
    this.dependencies = dependencies;
  }

  /** Includes attachments even when the description contains no link to them. */
  public async references(
    actor: User,
    ticketId: string,
    description: string,
  ): Promise<readonly AgentTicketAsset[]> {
    try {
      const attachments = await this.dependencies.tickets.list(actor, ticketId);
      const references = new Map<string, AgentTicketAsset>();
      for (const attachment of attachments) {
        const link = `/aufgaben/attachments/${attachment.id}`;
        references.set(link, { source: "ticket", id: attachment.id, link });
      }
      for (const reference of ticketAssetReferences(description))
        references.set(reference.link, reference);
      return [...references.values()];
    } catch (error: unknown) {
      logCaughtError("AgentTicketAssetService", error);

      if (error instanceof AgentError) throw error;
      throw new AgentError("parameter_asset_unavailable");
    }
  }

  /** Reads the entire file; missing storage, revoked access and invalid text fail closed. */
  public async read(
    actor: User,
    asset: AgentTicketAsset,
  ): Promise<AgentTicketAssetBytes> {
    let fileName = asset.id;
    try {
      const opened = await this.open(actor, asset);
      fileName = opened.fileName;
      return await readInline(opened);
    } catch (error: unknown) {
      logCaughtError("AgentTicketAssetService", error);

      throw new AgentAssetError(readFailureCode(asset, error), asset, fileName);
    }
  }

  /**
   * Reads a file for the handover to a plan step, whatever its size up to the plan limit.
   *
   * @remarks
   * A file that fits `inlineBytes` is read like {@link read}. A larger one is
   * measured as a stream, in constant memory, and returned without bytes or
   * model content. Beyond 512 MiB (`PLAN_HANDOVER_LIMITS.bytes`) it is refused,
   * never cut.
   *
   * @param actor - The person the step runs for.
   * @param asset - The referenced file.
   * @param inlineBytes - What may still be held in memory for this handover.
   */
  public async readForHandover(
    actor: User,
    asset: AgentTicketAsset,
    inlineBytes: number,
  ): Promise<AgentTicketAssetBytes | AgentTicketAssetStream> {
    let fileName = asset.id;
    try {
      const opened = await this.open(actor, asset);
      fileName = opened.fileName;
      if (opened.size <= Math.min(inlineBytes, MAX_TICKET_ASSET_BYTES))
        return await readInline(opened);
      if (opened.size > PLAN_HANDOVER_LIMITS.bytes) {
        opened.stream.destroy();
        throw new AgentError("parameter_assets_too_large");
      }
      return await this.measureStream(actor, asset, opened);
    } catch (error: unknown) {
      logCaughtError("AgentTicketAssetService", error);

      throw new AgentAssetError(readFailureCode(asset, error), asset, fileName);
    }
  }

  /**
   * Proves the person may still read the file and that its bytes are there.
   *
   * @remarks
   * A file of up to 10 MiB is read completely like {@link read}; a larger one
   * is only opened, because its rights are what a saved result depends on and
   * its content was measured when it was handed over.
   */
  public async requireReadable(
    actor: User,
    asset: AgentTicketAsset,
  ): Promise<void> {
    let fileName = asset.id;
    try {
      const opened = await this.open(actor, asset);
      fileName = opened.fileName;
      if (opened.size <= MAX_TICKET_ASSET_BYTES) await readInline(opened);
      else opened.stream.destroy();
    } catch (error: unknown) {
      logCaughtError("AgentTicketAssetService", error);

      throw new AgentAssetError(readFailureCode(asset, error), asset, fileName);
    }
  }

  /** Opens the original again for a copy, under the live rights of the person. */
  public async stream(actor: User, asset: AgentTicketAsset): Promise<Readable> {
    try {
      return (await this.open(actor, asset)).stream;
    } catch (error: unknown) {
      logCaughtError("AgentTicketAssetService", error);

      throw new AgentAssetError(readFailureCode(asset, error), asset, asset.id);
    }
  }

  private async measureStream(
    actor: User,
    asset: AgentTicketAsset,
    opened: OpenedAsset,
  ): Promise<AgentTicketAssetStream> {
    // Stored files never change under their identifier, so a measurement made
    // once stays valid; whoever consumes the bytes compares them with it anyway.
    const key = `${asset.source}:${asset.id}:${opened.size}`;
    let measured = this.measured.get(key);
    if (measured) opened.stream.destroy();
    else {
      const digest = await digestStream(opened.stream, opened.size).catch(
        (error: unknown) => {
          if (error instanceof StreamTooLargeError)
            throw new AgentError("parameter_asset_unavailable");
          throw error;
        },
      );
      if (digest.size !== opened.size)
        throw new AgentError("parameter_asset_unavailable");
      measured = {
        digest: digest.digest,
        mimeType: detectTicketFileType(digest.head).contentType,
      };
      this.remember(key, measured);
    }
    return {
      fileName: opened.fileName,
      size: opened.size,
      content: { type: "file", reason: STREAMED_ASSET_REASON },
      original: {
        mimeType: measured.mimeType,
        size: opened.size,
        digest: measured.digest,
      },
      open: () => this.stream(actor, asset),
    };
  }

  private remember(key: string, measured: MeasuredAsset): void {
    if (this.measured.size >= MEASURED_ASSET_ENTRIES) {
      const oldest = this.measured.keys().next();
      if (!oldest.done) this.measured.delete(oldest.value);
    }
    this.measured.set(key, measured);
  }

  private async open(
    actor: User,
    asset: AgentTicketAsset,
  ): Promise<{
    readonly fileName: string;
    readonly size: number;
    readonly stream: Readable;
  }> {
    if (asset.source === "agent")
      return this.dependencies.assets.open(actor, asset.id);
    if (asset.source === "plan") {
      if (!this.dependencies.plans)
        throw new AgentError("parameter_asset_transfer_unsupported");
      const opened = await this.dependencies.plans.open(actor.id, asset.id);
      return {
        fileName: opened.record.fileName,
        size: opened.record.size,
        stream: opened.stream,
      };
    }
    const opened =
      asset.source === "wiki"
        ? await this.dependencies.wiki.openAttachment(actor, asset.id)
        : await this.dependencies.tickets.open(actor, asset.id);
    return { ...opened.attachment, stream: opened.stream };
  }
}

/** Reads a file of at most {@link MAX_TICKET_ASSET_BYTES} completely and derives its model content. */
async function readInline(opened: OpenedAsset): Promise<AgentTicketAssetBytes> {
  const bytes = await readBytes(opened.stream);
  if (bytes.length !== opened.size)
    throw new AgentError("parameter_asset_unavailable");
  const representation = await assetRepresentation(bytes);
  return {
    fileName: opened.fileName,
    content: representation.content,
    original: {
      mimeType: representation.mimeType,
      size: bytes.length,
      digest: createHash("sha256").update(bytes).digest("hex"),
    },
    bytes,
    size: bytes.length,
  };
}

/** The code of a failed read; a plan asset names its own causes instead of a ticket's. */
function readFailureCode(
  asset: AgentTicketAsset,
  error: unknown,
): AgentErrorCode {
  const code =
    error instanceof AgentError ? error.code : "parameter_asset_unavailable";
  if (asset.source !== "plan") return code;
  if (code === "parameter_assets_too_large") return "plan_asset_too_large";
  return code === "parameter_asset_unavailable"
    ? "plan_asset_unreadable"
    : code;
}

async function readBytes(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      if (!Buffer.isBuffer(chunk))
        throw new AgentError("parameter_asset_unavailable");
      size += chunk.length;
      if (size > MAX_TICKET_ASSET_BYTES)
        throw new AgentError("parameter_assets_too_large");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally {
    stream.destroy();
  }
}
