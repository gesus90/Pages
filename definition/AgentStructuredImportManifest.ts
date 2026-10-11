import type {
  AgentImportAction,
  AgentImportCounts,
} from "./AgentImportApply.js";
import type { AgentImportIssue } from "./AgentImportManifest.js";
import type {
  AgentMilestoneLinkType,
  AgentTicketType,
} from "./AgentTickets.js";
import type { PagesAgentApiErrorCode } from "./PagesAgentApi.js";
import type { AgentWikiCreated } from "./PagesAgentWrites.js";

/** Bounds of one structured manifest; the wiki package follows the A9.7 limits. */
export const AGENT_STRUCTURED_IMPORT_LIMITS = {
  sources: 100,
  links: 200,
  assets: 32,
  keyLength: 100,
} as const;

/** The kinds of source a manifest holds. */
export type AgentStructuredSourceKind =
  "project" | "milestone" | "ticket" | "wiki";

/** An existing project that other sources hang on; it is only ever referenced, never created. */
export interface AgentStructuredProject {
  readonly kind: "project";
  readonly key: string;
  readonly projectId: string;
}

/** A milestone to create in a referenced project. */
export interface AgentStructuredMilestone {
  readonly kind: "milestone";
  readonly key: string;
  /** Key of a project source; filled in when the manifest has exactly one. */
  readonly project: string;
  readonly name: string;
  readonly description: string;
  readonly startAt: string | null;
  readonly dueAt: string | null;
}

/** A ticket to create locally in a referenced project. */
export interface AgentStructuredTicket {
  readonly kind: "ticket";
  readonly key: string;
  /** Key of a project source; filled in when the manifest has exactly one. */
  readonly project: string;
  readonly type: AgentTicketType;
  readonly title: string;
  readonly description: string;
}

/** One Markdown page; its key is the relative path, as in the A9.7 manifest. */
export interface AgentStructuredWikiSource {
  readonly kind: "wiki";
  readonly key: string;
  readonly content: string;
  readonly title?: string;
}

/** Any source of a structured manifest. */
export type AgentStructuredSource =
  | AgentStructuredProject
  | AgentStructuredMilestone
  | AgentStructuredTicket
  | AgentStructuredWikiSource;

/** A link between two sources of the same manifest. */
export type AgentStructuredLink =
  | {
      readonly type: "parent";
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly type: "milestone";
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly type: "dependency";
      readonly from: string;
      readonly to: string;
      readonly linkType: AgentMilestoneLinkType;
    };

/** Maps the relative path a Markdown link uses to a staged asset of the caller. */
export interface AgentStructuredAsset {
  readonly path: string;
  readonly assetId: string;
}

/** Where the wiki pages go: an explicit project and an explicit parent, `null` for the root. */
export interface AgentStructuredWikiTarget {
  readonly project: string;
  readonly parentId: string | null;
}

/** The versioned manifest of an agent-driven structured import. */
export interface AgentStructuredManifest {
  readonly version: "1";
  readonly sources: readonly AgentStructuredSource[];
  readonly links: readonly AgentStructuredLink[];
  readonly assets: readonly AgentStructuredAsset[];
  readonly wiki: AgentStructuredWikiTarget | null;
}

/** A structured import to preview: only the manifest, never an actor or a permission. */
export interface AgentStructuredImportInput {
  readonly manifest: AgentStructuredManifest;
}

/** A confirmed structured import; the client keeps its operation ID for response-loss recovery. */
export interface AgentStructuredImportApplyInput extends AgentStructuredImportInput {
  readonly operationId: string;
  readonly fingerprint: string;
}

/** The kinds of object a plan lists; a dependency is one link between two milestones. */
export type AgentStructuredKind =
  "project" | "milestone" | "ticket" | "wiki" | "dependency";

/** What the import would do with one object. */
export type AgentStructuredAction =
  "reference" | "create" | "unchanged" | "conflict" | "invalid" | "blocked";

/** Why a plan or a result reports a problem; wiki reasons are those of the A9.7 plan. */
export type AgentStructuredReason =
  | AgentImportIssue["reason"]
  | "invalid_key"
  | "duplicate_key"
  | "project_required"
  | "unknown_project"
  | "project_unavailable"
  | "missing_reference"
  | "duplicate_link"
  | "self_reference"
  | "cycle"
  | "parent_type"
  | "parent_required"
  | "project_mismatch"
  | "invalid_field"
  | "wiki_target_required"
  | "invalid_asset_path"
  | "duplicate_asset_path"
  | "asset_unavailable"
  | "asset_shared"
  | "source_changed"
  | "target_changed"
  | "target_removed"
  | "blocked";

/** A problem of the manifest or of the target, naming the sources it concerns. */
export interface AgentStructuredIssue {
  readonly code: "INVALID_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT";
  readonly reason: AgentStructuredReason;
  /** Plan keys of the objects concerned; never a name of an object the caller cannot see. */
  readonly keys: readonly string[];
  readonly limit?: number;
}

/** A referenced project with what the caller may do in it. */
export interface AgentStructuredPlanProject {
  readonly key: string;
  readonly projectId: string;
  readonly canWriteTickets: boolean;
  readonly canManageMilestones: boolean;
}

/** One object of the plan, in the order the import applies it. */
export interface AgentStructuredObject {
  readonly kind: AgentStructuredKind;
  /** Plan key: `ticket:<key>`, `milestone:<key>`, `project:<key>`, or the A9.7 page key. */
  readonly key: string;
  /** The key under which the mapping of a repeated import is stored. */
  readonly sourceKey: string;
  readonly label: string;
  readonly project: string | null;
  readonly action: AgentStructuredAction;
  readonly reason: AgentStructuredReason | null;
  /** The target a repeated import maps to, when it exists and is visible. */
  readonly targetId: string | null;
}

/** A link of the plan between two plan keys. */
export interface AgentStructuredEdge {
  readonly type:
    "parent" | "milestone" | "dependency" | "wiki_parent" | "asset";
  readonly from: string;
  readonly to: string;
  readonly linkType?: AgentMilestoneLinkType;
}

/** An asset of the manifest with the state it is in and the page using it. */
export interface AgentStructuredPlanAsset {
  readonly path: string;
  readonly assetId: string;
  readonly state: "staged" | "linked" | "unavailable";
  readonly usedBy: readonly string[];
}

/** A relative link of a page and what the import makes of it. */
export interface AgentStructuredLinkOutcome {
  readonly sourceKey: string;
  readonly url: string;
  readonly kind: "image" | "file";
  /** The asset it points to after the import, or `null` when the link stays as written. */
  readonly assetId: string | null;
  readonly reason: "no_asset" | "outside_root" | "unsupported_syntax" | null;
}

/** What leaves Pages because of the import: only the GitHub publication, under the project setting. */
export interface AgentStructuredExternalEffect {
  readonly kind: "github_publication";
  readonly project: string;
  readonly projectId: string;
  /** Whether the synchronization of the project is switched on right now. */
  readonly syncEnabled: boolean;
  /** How many tickets the import would create in the project. */
  readonly tickets: number;
}

/** Read-only preview. A fingerprint or a valid plan never grants permission to apply it. */
export interface AgentStructuredImportPlan {
  readonly fingerprint: string;
  readonly projects: readonly AgentStructuredPlanProject[];
  readonly objects: readonly AgentStructuredObject[];
  readonly edges: readonly AgentStructuredEdge[];
  readonly errors: readonly AgentStructuredIssue[];
  readonly conflicts: readonly AgentStructuredIssue[];
  readonly assets: readonly AgentStructuredPlanAsset[];
  readonly links: readonly AgentStructuredLinkOutcome[];
  readonly valid: boolean;
  readonly externalEffects: readonly AgentStructuredExternalEffect[];
}

/** One source's outcome; targets and links are those the run resolved, never a global lookup. */
export interface AgentStructuredImportItem {
  readonly kind: Exclude<AgentStructuredKind, "project">;
  readonly sourceKey: string;
  readonly targetKey: string;
  readonly action: AgentImportAction;
  readonly targetId: string | null;
  /** The key of a ticket, e.g. `PAGE-12`. */
  readonly key: string | null;
  readonly link: string | null;
  /** The parent ticket of a ticket as resolved in this run. */
  readonly parentId: string | null;
  /** The milestone of a ticket as resolved in this run. */
  readonly milestoneId: string | null;
  readonly assets: AgentWikiCreated["assets"];
  readonly reason: AgentStructuredReason | null;
  readonly errorCode: PagesAgentApiErrorCode | null;
}

/** Completed run, reconstructed unchanged from its durable source outcomes. */
export interface AgentStructuredImportApplied {
  readonly runId: string;
  readonly status: "complete" | "partial";
  readonly counts: AgentImportCounts;
  readonly items: readonly AgentStructuredImportItem[];
}
