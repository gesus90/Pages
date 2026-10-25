import { ADDITIVE_ANNOTATIONS, IDENTIFIER_SCHEMA } from "./ToolDefinition.js";
import { WIKI_IMPORT_PLAN_TOOL } from "./WikiImportPlan.js";

import type { Tool } from "@modelcontextprotocol/server";

/** Applies a confirmed content package, using the same bounded manifest as the planner. */
export const WIKI_IMPORT_APPLY_TOOL: Tool = {
  name: "apply_wiki_import",
  title: "Apply wiki import",
  description:
    "Applies a plan_wiki_import content package in its explicit project and parent. Repeat the exact manifest and its fingerprint. Supply a new operationId per package; reuse it unchanged after response loss or interruption to recover the same run and page/attachment IDs. A new run needs a fresh plan; stale fingerprints return CONFLICT. Only loaded sources and required empty directories are applied. Import README/index group content before child packages. Results per source are created, skipped, conflict or failed; changed sources, target revisions or placement are never overwritten. Optional assets bind each loaded sourceKey to your own staged assetIds from prepare_asset_upload. Markdown is retained exactly; relative links are not rewritten. Rights and credentials are rechecked for each source. 128 index entries, 32 files, 16 KiB per file, 32 KiB content, 64 KiB request, 1 MiB response; timeout 30 seconds. Source outcomes persist independently, so repeat safely after timeout.",
  inputSchema: {
    ...WIKI_IMPORT_PLAN_TOOL.inputSchema,
    required: [
      "operationId",
      "fingerprint",
      "projectId",
      "parentId",
      "manifest",
    ],
    properties: {
      ...WIKI_IMPORT_PLAN_TOOL.inputSchema.properties,
      operationId: IDENTIFIER_SCHEMA,
      fingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
      assets: {
        type: "array",
        maxItems: 32,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["sourceKey", "assetIds"],
          properties: {
            sourceKey: { type: "string", minLength: 1 },
            assetIds: {
              type: "array",
              maxItems: 100,
              uniqueItems: true,
              items: IDENTIFIER_SCHEMA,
            },
          },
        },
      },
    },
  },
  annotations: ADDITIVE_ANNOTATIONS,
};
