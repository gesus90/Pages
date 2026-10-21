import {
  DESTRUCTIVE_ANNOTATIONS,
  IDENTIFIER_SCHEMA,
  REVISION_SCHEMA,
} from "./tool-definition.js";
import { WIKI_IMPORT_PLAN_TOOL } from "./wiki-import-plan.js";

import type { Tool } from "@modelcontextprotocol/server";

/** Updates imported pages from changed sources; only mapped pages, never overwriting unless asked. */
export const WIKI_IMPORT_UPDATE_TOOL: Tool = {
  name: "update_wiki_import",
  title: "Update imported wiki pages",
  description:
    "Brings pages created by apply_wiki_import up to date with changed Markdown sources. Plan the changed content package first, then repeat its exact manifest and fingerprint with a new operationId and one update entry per loaded file: sourceKey, the page revision you read with read_wiki_page as expectedRevision, and overwrite (default false). Only pages mapped to a sourceKey are touched; a page with the same title that was not imported is never adopted (failed, not_imported). Per source: updated (new revision, the previous text stays in the page versions), skipped (the page already shows the source, no revision), conflict (stale_revision, manual_change after the import, title_conflict, template, plan_conflict) or failed. A page revised in Pages after its import is replaced only with overwrite true. Placement and icon never change. All updates of one call commit together; a repeated operationId returns the stored result. Rights and credentials are rechecked. 128 index entries, 32 files, 16 KiB per file, 32 KiB content, 64 KiB request, 1 MiB response; timeout 30 seconds.",
  inputSchema: {
    ...WIKI_IMPORT_PLAN_TOOL.inputSchema,
    required: [
      "operationId",
      "fingerprint",
      "projectId",
      "parentId",
      "manifest",
      "updates",
    ],
    properties: {
      ...WIKI_IMPORT_PLAN_TOOL.inputSchema.properties,
      operationId: IDENTIFIER_SCHEMA,
      fingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
      updates: {
        type: "array",
        minItems: 1,
        maxItems: 32,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["sourceKey", "expectedRevision"],
          properties: {
            sourceKey: { type: "string", minLength: 1 },
            expectedRevision: REVISION_SCHEMA,
            overwrite: { type: "boolean", default: false },
          },
        },
      },
    },
  },
  annotations: DESTRUCTIVE_ANNOTATIONS,
};
