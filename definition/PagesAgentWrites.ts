import { AGENT_EXTENSION_WRITE_OPERATIONS } from "./AgentExtensions.js";
import { AGENT_ADMIN_WRITE_OPERATIONS } from "./AgentAdministration.js";
import { AGENT_WORKSPACE_WRITE_OPERATIONS } from "./AgentWorkspaceOperations.js";
import { AGENT_TICKET_LINK_OPERATIONS } from "./AgentTicketNavigation.js";

import type { AgentAdminChanged } from "./AgentAdministration.js";
import type { AgentExtensionChanged } from "./AgentExtensions.js";
import type { AgentImportApplied } from "./AgentImportApply.js";
import type { AgentImportUpdated } from "./AgentImportUpdate.js";
import type { AgentWorkspaceChanged } from "./AgentWorkspaceOperations.js";
import type { AgentStructuredImportApplied } from "./AgentStructuredImportManifest.js";
import type { AgentChecklistItemChanged } from "./AgentTicketChecklist.js";
import type { AgentTicketLinkChanged } from "./AgentTicketNavigation.js";
import type {
  AgentMilestoneChanged,
  AgentMilestoneCreated,
  AgentMilestoneDependencyChanged,
  AgentTicketChanged,
  AgentTicketCreated,
} from "./AgentTickets.js";
import type {
  AgentWikiCommentAdded,
  AgentWikiCommentChanged,
} from "./AgentWikiComments.js";
import type {
  AgentWikiCoverChanged,
  AgentWikiPageChanged,
  AgentWikiPageMoved,
} from "./AgentWikiFields.js";

/** Write operations offered to verified accounts; Pages applies the corresponding UI rights per call. */
export const PAGES_AGENT_WRITE_OPERATIONS = [
  ...AGENT_EXTENSION_WRITE_OPERATIONS,
  ...AGENT_ADMIN_WRITE_OPERATIONS,
  ...AGENT_WORKSPACE_WRITE_OPERATIONS,
  "assets.upload.prepare",
  "wiki.page.create",
  "wiki.import.apply",
  "wiki.import.update",
  "import.structured.apply",
  "wiki.page.setTitle",
  "wiki.page.setContent",
  "wiki.page.setIcon",
  "wiki.page.setCover",
  "wiki.page.move",
  "ticket.create",
  "ticket.setTitle",
  "ticket.setDescription",
  "ticket.setStatus",
  "ticket.setParent",
  "ticket.checklist.setItem",
  ...AGENT_TICKET_LINK_OPERATIONS,
  "milestone.create",
  "milestone.setName",
  "milestone.setDescription",
  "milestone.setStatus",
  "milestone.setStartAt",
  "milestone.setDueAt",
  "milestone.dependency.add",
  "milestone.dependency.remove",
] as const;

/** An implemented write operation. */
export type PagesAgentWriteOperation =
  (typeof PAGES_AGENT_WRITE_OPERATIONS)[number];

/** Binary upload instructions; the ticket is sent only through the named header. */
export interface AgentUploadTicket {
  readonly ticket: string;
  readonly header: "X-Pages-Upload-Ticket";
  readonly uploadPath: "/api/v1/agent-assets";
  readonly expiresAt: number;
  readonly mediaLimitBytes: number;
  readonly fileLimitBytes: number;
}

/** Public asset handle, with a stable authenticated download path. */
export interface AgentAsset {
  readonly assetId: string;
  readonly link: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: number;
}

/** Explicit wiki creation with a named scope and parent, without overwriting. */
export interface AgentWikiCreateInput {
  readonly operationId: string;
  readonly projectId: string | null;
  readonly scope?: "project" | "instance" | "private";
  readonly parentId: string | null;
  readonly title: string;
  readonly content: string;
  readonly icon: string | null;
  readonly assetIds: readonly string[];
}

/** Persisted result returned unchanged on a matching operation replay. */
export interface AgentWikiCreated {
  readonly pageId: string;
  readonly link: string;
  readonly assets: readonly {
    readonly assetId: string;
    readonly attachmentId: string;
    readonly link: string;
  }[];
}

/** Version-one write result envelope. */
export interface PagesAgentWriteResponse {
  readonly apiVersion: "1";
  readonly result:
    | AgentUploadTicket
    | AgentWikiCreated
    | AgentImportApplied
    | AgentImportUpdated
    | AgentStructuredImportApplied
    | AgentWikiPageChanged
    | AgentWikiCoverChanged
    | AgentWikiPageMoved
    | AgentWikiCommentAdded
    | AgentWikiCommentChanged
    | AgentTicketCreated
    | AgentTicketChanged
    | AgentChecklistItemChanged
    | AgentTicketLinkChanged
    | AgentMilestoneCreated
    | AgentMilestoneChanged
    | AgentMilestoneDependencyChanged
    | AgentExtensionChanged
    | AgentAdminChanged
    | AgentWorkspaceChanged;
}
