/** Bounded A9.7 packages; the complete JSON envelope must also fit the agent API limit. */
export const AGENT_IMPORT_LIMITS = {
  indexEntries: 128,
  files: 32,
  fileBytes: 16_384,
  contentBytes: 32_768,
  pathBytes: 512,
} as const;

/** How a content source determines its page title. */
export type AgentImportTitleSource = "explicit" | "h1" | "filename";

/** Complete, content-free source index, repeated in every package. */
export interface AgentImportIndexEntry {
  readonly sourceKey: string;
  readonly title: string;
  readonly titleSource: AgentImportTitleSource;
}

/** One source's exact Markdown; explicit titles take precedence over H1. */
export interface AgentImportFile {
  readonly sourceKey: string;
  readonly content: string;
  readonly title?: string;
}

/** Versioned source index plus a bounded package; an empty package plans the index first. */
export interface AgentImportManifest {
  readonly version: "1";
  readonly index: readonly AgentImportIndexEntry[];
  readonly files: readonly AgentImportFile[];
}

/** Explicit destination, never inferred from document metadata. */
export interface AgentImportPlanInput {
  readonly projectId: string;
  readonly parentId: string | null;
  readonly manifest: AgentImportManifest;
}

/** An existing destination or another proposed page; proposed keys are never persisted IDs. */
export type AgentImportParent =
  | { readonly kind: "existing"; readonly pageId: string | null }
  | { readonly kind: "planned"; readonly key: string };

/** Diagnoses only client sources and visible targets. Limits are explicit when relevant. */
export interface AgentImportIssue {
  readonly code: "INVALID_REQUEST" | "FORBIDDEN" | "CONFLICT";
  readonly reason:
    | "invalid_path"
    | "duplicate_source"
    | "duplicate_content"
    | "title_conflict"
    | "group_content_conflict"
    | "index_mismatch"
    | "missing_index_entry"
    | "invalid_title"
    | "tree_too_deep"
    | "invalid_parent"
    | "write_permission_required";
  readonly sourceKeys: readonly string[];
  readonly targetKey?: string;
  readonly existingPageIds?: readonly string[];
  readonly limit?: number;
}

/** A target page without creation, implicit reuse or overwriting. */
export interface AgentImportPage {
  readonly key: string;
  readonly title: string;
  readonly titleSource: AgentImportTitleSource | "directory";
  readonly sourceKeys: readonly string[];
  readonly isDirectory: boolean;
  /** Null means this source's contents are in another package. Empty groups have zero bytes. */
  readonly contentBytes: number | null;
  readonly level: number;
  readonly action: "create" | "conflict" | "invalid" | "blocked";
}

/** Explicit parent edge, including the selected existing parent or project root. */
export interface AgentImportEdge {
  readonly childKey: string;
  readonly parent: AgentImportParent;
}

/** A relative asset mention, never fetched, uploaded, linked or rewritten. */
export interface AgentImportAsset {
  readonly sourceKey: string;
  readonly url: string;
  readonly kind: "image" | "file";
}

/** Read-only preview. A fingerprint or a valid plan never grants permission to apply it. */
export interface AgentImportPlan {
  readonly projectId: string;
  readonly parentId: string | null;
  readonly fingerprint: string;
  readonly pages: readonly AgentImportPage[];
  readonly edges: readonly AgentImportEdge[];
  readonly errors: readonly AgentImportIssue[];
  readonly conflicts: readonly AgentImportIssue[];
  readonly assets: readonly AgentImportAsset[];
  /** Assets are scanned only in this package; this field reports coverage of the whole index. */
  readonly contentComplete: boolean;
  readonly valid: boolean;
  readonly limits: typeof AGENT_IMPORT_LIMITS;
  readonly externalEffects: readonly [];
}
