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
  readonly content:
    | {
        readonly type: "image";
        readonly mimeType: "image/png";
        readonly base64: string;
      }
    | { readonly type: "text"; readonly text: string };
}
