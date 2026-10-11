import type { AgentImportPlanInput } from "./AgentImportManifest.js";
import type { PagesAgentApiErrorCode } from "./PagesAgentApi.js";

/** One imported Markdown source to bring up to date, bound to the page revision the caller read. */
export interface AgentImportUpdateEntry {
  readonly sourceKey: string;
  readonly expectedRevision: number;
  /** Replaces a page revised after its import. Never implied; the default is `false`. */
  readonly overwrite: boolean;
}

/** A confirmed content package whose loaded files all belong to previously imported pages. */
export interface AgentImportUpdateInput extends AgentImportPlanInput {
  readonly operationId: string;
  readonly fingerprint: string;
  readonly updates: readonly AgentImportUpdateEntry[];
}

/** Outcome of one source; `updated` is the only action that writes a page revision. */
export type AgentImportUpdateAction =
  "updated" | "skipped" | "conflict" | "failed";

/** Why a source ended in its action; conflicts list what the caller has to decide. */
export type AgentImportUpdateReason =
  | "source_changed"
  | "overwritten"
  | "unchanged"
  | "stale_revision"
  | "manual_change"
  | "title_conflict"
  | "template"
  | "plan_conflict"
  | "not_imported"
  | "page_unavailable"
  | "invalid_source"
  | "not_permitted";

/** A source result exposes only an authorized page, its revision and fixed codes. */
export interface AgentImportUpdateItem {
  readonly sourceKey: string;
  readonly targetKey: string;
  readonly action: AgentImportUpdateAction;
  readonly reason: AgentImportUpdateReason;
  readonly pageId: string | null;
  readonly link: string | null;
  /** The page revision after this operation: the new one when updated, otherwise the current one. */
  readonly revision: number | null;
  readonly errorCode: PagesAgentApiErrorCode | null;
}

/** Per-action totals of one update package. */
export interface AgentImportUpdateCounts {
  readonly updated: number;
  readonly skipped: number;
  readonly conflict: number;
  readonly failed: number;
}

/** Complete package result, returned unchanged when the operation ID is repeated. */
export interface AgentImportUpdated {
  readonly status: "complete" | "partial";
  readonly counts: AgentImportUpdateCounts;
  readonly items: readonly AgentImportUpdateItem[];
}
