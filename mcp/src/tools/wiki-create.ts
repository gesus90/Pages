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
      operationId: { type: "string", minLength: 1, maxLength: 200 },
      projectId: { type: ["string", "null"], minLength: 1, maxLength: 200 },
      scope: { type: "string", enum: ["project", "instance", "private"] },
      parentId: { type: ["string", "null"], minLength: 1, maxLength: 200 },
      title: { type: "string", minLength: 1, maxLength: 200 },
      content: { type: "string" },
      icon: { type: ["string", "null"] },
      assetIds: {
        type: "array",
        maxItems: 100,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 200 },
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
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
