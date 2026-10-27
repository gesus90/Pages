/** A Pages reference, reauthorized when its contents are sent to a runner. */
export interface AgentTicketAsset {
  readonly source: "ticket" | "wiki" | "agent";
  readonly id: string;
  readonly link: string;
}

/** One resolved ticket; binary contents never belong to a persisted plan snapshot. */
export interface ResolvedAgentTicket {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly assets: readonly AgentTicketAsset[];
  /** Compatible whole-ticket rendering, including separately stored criteria. */
  readonly markdown: string;
  readonly version: string;
}

/** The parameter name remains attached even when two parameters select the same ticket. */
export interface AgentTicketInput {
  readonly owner?: "ticket" | "wiki";
  /** Source/id keyed digests frozen during validation, without file contents. */
  readonly originals?: Readonly<Record<string, string>>;
  readonly parameter: string;
  readonly ticket: ResolvedAgentTicket;
}

/** Authorized contents for one transmission, never an instruction-text substitution. */
export interface AgentTicketAssetContent {
  readonly parameter: string;
  readonly ticketId: string;
  readonly ticketKey: string;
  readonly asset: AgentTicketAsset;
  readonly fileName: string;
  readonly owner?: { readonly type: "ticket" | "wiki"; readonly id: string };
  /** Original bytes are never reconstructed from a decoded text representation. */
  readonly original?: AgentAssetOriginal;
  /** In-memory handoff only; never included in plan snapshots or audit labels. */
  readonly bytes?: Uint8Array;
  readonly path?: string;
  readonly content:
    | {
        readonly type: "image";
        readonly mimeType: "image/png" | "image/jpeg" | "image/webp";
        readonly base64: string;
      }
    | {
        readonly type: "text";
        readonly text: string;
        readonly representation?: "source" | "text-extract";
        readonly isTruncated?: boolean;
      }
    | { readonly type: "file"; readonly reason: string };
}

/** Integrity and media identity of the authorized, byte-preserved original. */
export interface AgentAssetOriginal {
  readonly mimeType: string;
  readonly size: number;
  readonly digest: string;
}

/** Names the representation independently of the byte-preserved original. */
export function agentAssetRepresentation(
  content: AgentTicketAssetContent["content"],
): "original" | "source" | "text-extract" | "model-image" {
  if (content.type === "image") return "model-image";
  if (content.type === "text") return content.representation ?? "source";
  return "original";
}
