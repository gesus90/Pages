/** Binary access instructions for an authorized Pages original; credentials never belong in URLs. */
export interface AgentAssetDownload {
  readonly ticket: string;
  readonly header: "X-Pages-Download-Ticket";
  readonly downloadPath: "/api/v1/agent-assets";
  readonly expiresAt: number;
  readonly asset: {
    readonly source: "ticket" | "wiki" | "agent";
    readonly id: string;
    readonly link: string;
  };
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly digest: string;
  readonly representation:
    "model-image" | "source" | "text-extract" | "original";
  readonly modelContent: string;
}

/** Optional provenance and explicit revision selection for a returned ticket attachment. */
export interface AgentAssetReturn {
  readonly operationId: string;
  readonly sourceAttachmentId?: string;
  readonly sourceType?: "ticket" | "wiki" | "agent";
  readonly expectedDigest?: string;
  readonly replace?: boolean;
}
