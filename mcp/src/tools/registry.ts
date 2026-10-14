import { EXTENSION_READ_TOOLS } from "./extensions.js";
import { ADMIN_READ_TOOLS } from "./administration.js";
import { WORKSPACE_READ_TOOLS } from "./workspaces.js";
import { STRUCTURED_IMPORT_PLAN_TOOL } from "./structured-import-plan.js";
import {
  ASSIGNMENT_TARGETS_SEARCH_TOOL,
  TICKET_LINKS_READ_TOOL,
  TICKET_SEARCH_TOOL,
  TICKET_TREE_READ_TOOL,
} from "./ticket-search.js";
import { TICKET_CHECKLIST_READ_TOOL } from "./ticket-checklist.js";
import { MILESTONES_READ_TOOL, TICKET_READ_TOOL } from "./ticket-read.js";
import { WIKI_IMPORT_PLAN_TOOL } from "./wiki-import-plan.js";

import type { AgentExtensionReadOperation } from "../../../definition/AgentExtensions.js";
import type { AgentAdminReadOperation } from "../../../definition/AgentAdministration.js";
import type { AgentWorkspaceReadOperation } from "../../../definition/AgentWorkspaceOperations.js";
import type { Tool } from "@modelcontextprotocol/server";
import type {
  PagesAgentReadOperation,
  PagesAgentStructuredReadOperation,
  PagesAgentTicketReadOperation,
} from "../../../definition/PagesAgentOperations.js";

interface ReadTool {
  readonly operation:
    | AgentExtensionReadOperation
    | AgentAdminReadOperation
    | AgentWorkspaceReadOperation
    | PagesAgentReadOperation
    | PagesAgentStructuredReadOperation
    | PagesAgentTicketReadOperation;
  readonly tool: Tool;
}

const ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const TEXT = { type: "string", minLength: 1, maxLength: 200 } as const;

/** Fixed read-only tool descriptions; Pages determines which operations an identity may use. */
export const READ_TOOLS: readonly ReadTool[] = [
  ...EXTENSION_READ_TOOLS,
  ...ADMIN_READ_TOOLS,
  ...WORKSPACE_READ_TOOLS,
  {
    operation: "projects.resolve",
    tool: {
      name: "resolve_project",
      title: "Resolve project",
      description:
        "Resolves an exact trimmed case-sensitive project name. Multiple matches return AMBIGUOUS with at most 100 visible candidates; no target is chosen. Responses are limited to 1 MiB UTF-8 JSON.",
      inputSchema: {
        type: "object",
        properties: { name: TEXT },
        required: ["name"],
        additionalProperties: false,
      },
      annotations: ANNOTATIONS,
    },
  },
  {
    operation: "projects.read",
    tool: {
      name: "read_project",
      title: "Read project",
      description:
        "Reads the core details of a visible active project by ID. Missing and hidden projects both return NOT_FOUND. Responses are limited to 1 MiB UTF-8 JSON.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: TEXT,
          cursor: { type: ["string", "null"] },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["projectId"],
        additionalProperties: false,
      },
      annotations: ANNOTATIONS,
    },
  },
  {
    operation: "wiki.page.read",
    tool: {
      name: "read_wiki_page",
      title: "Read wiki page",
      description:
        "Reads complete Markdown, revision, icon (a single emoji or null) and cover (null, {kind:preset,preset} or {kind:attachment,attachmentId}) of a visible page without recording a visit. Hidden/private placeholders return NOT_FOUND. Content over 1 MiB UTF-8 returns PAYLOAD_TOO_LARGE; JSON escaping and metadata have a separate envelope budget.",
      inputSchema: {
        type: "object",
        properties: { pageId: TEXT },
        required: ["pageId"],
        additionalProperties: false,
      },
      annotations: ANNOTATIONS,
    },
  },
  {
    operation: "wiki.tree.read",
    tool: {
      name: "read_wiki_tree",
      title: "Read wiki tree",
      description:
        "Lists up to 100 visible wiki nodes per cursor page, optionally in a visible project. Includes visible total, nextCursor and truncated; visible parents on another page keep their IDs. Pass nextCursor with the same query to continue. Responses are limited to 1 MiB UTF-8 JSON.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: TEXT,
          cursor: { type: ["string", "null"] },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
      annotations: ANNOTATIONS,
    },
  },
  {
    operation: "wiki.search",
    tool: {
      name: "search_wiki",
      title: "Search wiki",
      description:
        "Searches visible wiki titles and Markdown, optionally in a visible project. Up to 100 hits per cursor page, snippets at most 200 Unicode characters, visible total, nextCursor and truncated. Pass nextCursor with the same query to continue. Responses are limited to 1 MiB UTF-8 JSON.",
      inputSchema: {
        type: "object",
        properties: {
          text: TEXT,
          projectId: TEXT,
          cursor: { type: ["string", "null"] },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["text"],
        additionalProperties: false,
      },
      annotations: ANNOTATIONS,
    },
  },
  { operation: "wiki.import.plan", tool: WIKI_IMPORT_PLAN_TOOL },
  { operation: "ticket.read", tool: TICKET_READ_TOOL },
  { operation: "ticket.checklist.read", tool: TICKET_CHECKLIST_READ_TOOL },
  { operation: "milestones.read", tool: MILESTONES_READ_TOOL },
  { operation: "tickets.search", tool: TICKET_SEARCH_TOOL },
  { operation: "tickets.tree.read", tool: TICKET_TREE_READ_TOOL },
  { operation: "tickets.links.read", tool: TICKET_LINKS_READ_TOOL },
  {
    operation: "assignment.targets.search",
    tool: ASSIGNMENT_TARGETS_SEARCH_TOOL,
  },
  { operation: "import.structured.plan", tool: STRUCTURED_IMPORT_PLAN_TOOL },
];
