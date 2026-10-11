import type { Tool } from "@modelcontextprotocol/server";

const IDENTIFIER = { type: "string", minLength: 1, maxLength: 200 } as const;
const PAGE_REFERENCE = {
  type: ["string", "null"],
  minLength: 1,
  maxLength: 200,
};

/** Moves one project page, with its subtree, to an explicit place; text and icon stay. */
export const WIKI_MOVE_TOOL: Tool = {
  name: "move_wiki_page",
  title: "Move wiki page",
  description:
    "Moves one project page with its subtree below parentId (null for a root page of the project) in projectId, before the sibling beforeId (null to append). pageId, parentId and beforeId are page IDs or Pages addresses such as /wiki/<id>. expectedRevision is the revision you read with read_wiki_page; a page saved since then returns CONFLICT and nothing moves. The target project, parent and sibling must be visible and belong together, else NOT_FOUND. A move below the page itself or its descendants, below a template or deeper than ten levels returns INVALID_REQUEST; without the right to manage the page the call returns FORBIDDEN. Only the place changes; a move keeps the revision. The result tells whether the page moved and how the move changed who sees it (same, wider, narrower, different): milestone and epic anchors of the old project are dropped when the project changes. Reuse operationId with identical input to recover the stored result after response loss; changed input returns CONFLICT. JSON request maximum 64 KiB.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      operationId: IDENTIFIER,
      pageId: IDENTIFIER,
      expectedRevision: { type: "integer", minimum: 1 },
      projectId: IDENTIFIER,
      parentId: PAGE_REFERENCE,
      beforeId: PAGE_REFERENCE,
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
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
};
