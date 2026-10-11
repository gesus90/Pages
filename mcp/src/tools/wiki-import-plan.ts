import type { Tool } from "@modelcontextprotocol/server";

const SOURCE_KEY = {
  type: "string",
  minLength: 1,
  description:
    "Relative NFC Markdown path, at most 512 UTF-8 bytes; no absolute paths, dot segments or backslashes.",
} as const;

/** Read-only, stateless planning contract with a full path/title index in every package. */
export const WIKI_IMPORT_PLAN_TOOL: Tool = {
  name: "plan_wiki_import",
  title: "Plan wiki import",
  description:
    "Plans Markdown without writes, visits, uploads or external calls. First send the complete index with files:[], then repeat it with each content package. Index titles use explicit, first top-level H1, then filename; loaded files verify these claims. Directories become page nodes; README.md/index.md supply group content. Returns pages, edges, errors, conflicts, relative asset mentions and SHA-256 fingerprint. Existing pages are never adopted or overwritten. Hidden and missing destinations return NOT_FOUND (not found or no access). Depth maximum ten including existing ancestors. Maximum 128 index entries, 32 files, 16 KiB per file, 32 KiB total content, 64 KiB whole request, 1 MiB response. Limits count UTF-8 bytes, including JSON escapes for transport. Apply a confirmed content package separately with apply_wiki_import.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["projectId", "parentId", "manifest"],
    properties: {
      projectId: { type: "string", minLength: 1, maxLength: 200 },
      parentId: { type: ["string", "null"], minLength: 1, maxLength: 200 },
      manifest: {
        type: "object",
        additionalProperties: false,
        required: ["version", "index", "files"],
        properties: {
          version: { const: "1", type: "string" },
          index: {
            type: "array",
            minItems: 1,
            maxItems: 128,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["sourceKey", "title", "titleSource"],
              properties: {
                sourceKey: SOURCE_KEY,
                title: { type: "string", minLength: 1, maxLength: 200 },
                titleSource: {
                  type: "string",
                  enum: ["explicit", "h1", "filename"],
                },
              },
            },
          },
          files: {
            type: "array",
            maxItems: 32,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["sourceKey", "content"],
              properties: {
                sourceKey: SOURCE_KEY,
                content: {
                  type: "string",
                  description: "Exact Markdown, at most 16 KiB UTF-8.",
                },
                title: { type: "string", minLength: 1, maxLength: 200 },
              },
            },
          },
        },
      },
    },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
