import { AgentError } from "@/backend/error/AgentErrors";
import { detectFileType } from "@/backend/service/wiki/WikiFileTypes";

import { ticketAssetReferences } from "./AgentTicketAssetReferences";

import type { Readable } from "node:stream";
import type { User } from "@/definition/User";
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
}

/** Bounded per transmission; exceeding the limit fails instead of truncating. */
export const MAX_TICKET_ASSET_BYTES = 10 * 1024 * 1024;

/** Discovers ticket attachments and opens every reference through its original access policy. */
export class AgentTicketAssetService {
  private readonly dependencies: AgentTicketAssetDependencies;

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
      if (error instanceof AgentError) throw error;
      throw new AgentError("parameter_asset_unavailable");
    }
  }

  /** Reads the entire file; missing storage, revoked access and invalid text fail closed. */
  public async read(
    actor: User,
    asset: AgentTicketAsset,
  ): Promise<{
    readonly fileName: string;
    readonly content: AgentTicketAssetContent["content"];
    readonly size: number;
  }> {
    try {
      const opened = await this.open(actor, asset);
      const bytes = await readBytes(opened.stream);
      if (bytes.length !== opened.size)
        throw new AgentError("parameter_asset_unavailable");
      return {
        fileName: opened.fileName,
        content: fileContent(bytes),
        size: bytes.length,
      };
    } catch (error: unknown) {
      if (error instanceof AgentError) throw error;
      throw new AgentError("parameter_asset_unavailable");
    }
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
    const opened =
      asset.source === "wiki"
        ? await this.dependencies.wiki.openAttachment(actor, asset.id)
        : await this.dependencies.tickets.open(actor, asset.id);
    return { ...opened.attachment, stream: opened.stream };
  }
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

function fileContent(bytes: Buffer): AgentTicketAssetContent["content"] {
  if (detectFileType(bytes).contentType === "image/png")
    return {
      type: "image",
      mimeType: "image/png",
      base64: bytes.toString("base64"),
    };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text))
      throw new Error("Binary file");
    return { type: "text", text };
  } catch {
    throw new AgentError("parameter_asset_type_unsupported");
  }
}
