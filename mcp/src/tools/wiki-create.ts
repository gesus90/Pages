import {
  ADDITIVE_ANNOTATIONS,
  IDENTIFIER_SCHEMA,
  NULLABLE_IDENTIFIER_SCHEMA,
} from "./tool-definition.js";

import type { Tool } from "@modelcontextprotocol/server";

/** Explicit, idempotent single-page creation contract; no implicit parent or project. */
export const WIKI_CREATE_TOOL: Tool = {
  name: "create_wiki_page",
  title: "Create wiki page",
  description:
    "Creates one page in an explicit project and parent (null for root), without overwriting. Reuse operationId with identical input to recover the same IDs after response loss; changed input returns CONFLICT. Only your own staged, unexpired assets can be linked. Text maximum 1 MiB UTF-8. Use scope=instance or private with projectId=null for an instance or private wiki root; scope defaults to project.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      operationId: IDENTIFIER_SCHEMA,
      projectId: NULLABLE_IDENTIFIER_SCHEMA,
      scope: { type: "string", enum: ["project", "instance", "private"] },
      parentId: NULLABLE_IDENTIFIER_SCHEMA,
      title: IDENTIFIER_SCHEMA,
      content: { type: "string" },
      icon: { type: ["string", "null"] },
      assetIds: {
        type: "array",
        maxItems: 100,
        uniqueItems: true,
        items: IDENTIFIER_SCHEMA,
      },
    },
    required: [
      "operationId",
      "projectId",
      "parentId",
      "title",
      "content",
      "icon",
      "assetIds",
    ],
  },
  annotations: ADDITIVE_ANNOTATIONS,
};
