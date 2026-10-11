import type { AgentImportPlanInput } from "./AgentImportManifest.js";
import type { PagesAgentApiErrorCode } from "./PagesAgentApi.js";
import type { AgentWikiCreated } from "./PagesAgentWrites.js";

/** Owner-bound staged assets to attach when this Markdown source first creates a page. */
export interface AgentImportAssetBinding {
  readonly sourceKey: string;
  readonly assetIds: readonly string[];
}

/** A confirmed, bounded package. The client keeps its operation ID for response-loss recovery. */
export interface AgentImportApplyInput extends AgentImportPlanInput {
  readonly operationId: string;
  readonly fingerprint: string;
  readonly assets: readonly AgentImportAssetBinding[];
}

/** Persistent outcome of one Markdown source or required directory node. */
export type AgentImportAction = "created" | "skipped" | "conflict" | "failed";

/** A source result exposes only an authorized page and fixed business error codes. */
export interface AgentImportItem {
  readonly sourceKey: string;
  readonly targetKey: string;
  readonly action: AgentImportAction;
  readonly pageId: string | null;
  readonly link: string | null;
  readonly assets: AgentWikiCreated["assets"];
  readonly errorCode: PagesAgentApiErrorCode | null;
}

/** Counts include required directory nodes as well as package Markdown sources. */
export interface AgentImportCounts {
  readonly created: number;
  readonly skipped: number;
  readonly conflict: number;
  readonly failed: number;
}

/** Completed package result, reconstructed unchanged from its durable source outcomes. */
export interface AgentImportApplied {
  readonly runId: string;
  readonly status: "complete" | "partial";
  readonly counts: AgentImportCounts;
  readonly items: readonly AgentImportItem[];
}
