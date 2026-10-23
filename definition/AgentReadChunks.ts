/** Shared MCP/Pica read budgets; byte counts always refer to UTF-8 JSON. */
export const AGENT_READ_LIMITS = {
  minimumChunkBytes: 1_024,
  chunkBytes: 65_536,
  totalBytes: 1_048_576,
  turnResultBytes: 2_097_152,
  planNodes: 500,
} as const;

/** A bounded part of a serialized read result, reassembled before JSON parsing. */
export interface AgentReadChunk {
  readonly chunk: {
    readonly text: string;
    readonly offsetBytes: number;
    readonly byteLength: number;
    readonly totalBytes: number;
    /** SHA-256 of the complete UTF-8 JSON result, before transport escaping. */
    readonly sha256: string;
    /** Bound to the account, query and exact snapshot; null after the last part. */
    readonly nextCursor: string | null;
  };
}
