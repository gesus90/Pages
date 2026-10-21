import {
  DESTRUCTIVE_ANNOTATIONS,
  IDENTIFIER_SCHEMA,
  NULLABLE_IDENTIFIER_SCHEMA,
  REVISION_SCHEMA,
} from "./tool-definition.js";

import type { Tool } from "@modelcontextprotocol/server";

/** Moves a wiki subtree to an explicit scope and place; text and icon stay. */
export const WIKI_MOVE_TOOL: Tool = {
  name: "move_wiki_page",
  title: "Move wiki page",
  description:
    "Moves a wiki page with its subtree below parentId (null for a root), before the sibling beforeId (null to append). Scope defaults to project; use scope=instance or private with projectId=null for other wiki roots. pageId, parentId and beforeId are page IDs or Pages addresses such as /wiki/<id>. expectedRevision is the revision from read_wiki_page; a stale save returns CONFLICT with currentRevision and nothing moves. Target project, parent and sibling must be visible and belong together, else NOT_FOUND. Cycles, templates and depth over ten return INVALID_REQUEST; without the right to manage the page the call returns FORBIDDEN. A move preserves the revision and returns its visibility effect. Milestone and epic anchors of an old project are dropped when the project changes. Reuse operationId with identical input after response loss. JSON request maximum 64 KiB.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      operationId: IDENTIFIER_SCHEMA,
      pageId: IDENTIFIER_SCHEMA,
      expectedRevision: REVISION_SCHEMA,
      projectId: { type: ["string", "null"], maxLength: 200 },
      scope: { type: "string", enum: ["project", "instance", "private"] },
      parentId: NULLABLE_IDENTIFIER_SCHEMA,
      beforeId: NULLABLE_IDENTIFIER_SCHEMA,
    },
    required: [
      "operationId",
      "pageId",
      "expectedRevision",
      "projectId",
      "parentId",
      "beforeId",
    ],
  },
  annotations: DESTRUCTIVE_ANNOTATIONS,
};
