import type { Tool } from "@modelcontextprotocol/server";

type FieldSchema = NonNullable<Tool["inputSchema"]["properties"]>[string];

const KEY: FieldSchema = {
  type: "string",
  minLength: 1,
  maxLength: 100,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
  description:
    "Key of a project, milestone or ticket source: letters, digits, dot, underscore and hyphen, at most 100 characters.",
};

/** The manifest of a structured import, shared by the plan and the apply tool. */
export const STRUCTURED_MANIFEST_SCHEMA: FieldSchema = {
  type: "object",
  additionalProperties: false,
  required: ["version", "sources"],
  properties: {
    version: { const: "1", type: "string" },
    sources: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "key"],
        properties: {
          kind: { enum: ["project", "milestone", "ticket", "wiki"] },
          key: {
            type: "string",
            minLength: 1,
            maxLength: 512,
            description:
              "project, milestone and ticket: a short key. wiki: the relative NFC Markdown path (at most 512 UTF-8 bytes).",
          },
          projectId: {
            type: "string",
            minLength: 1,
            maxLength: 200,
            description: "project only: the ID of an existing visible project.",
          },
          project: {
            ...KEY,
            description:
              "milestone and ticket: the key of a project source; may be left out when the manifest has exactly one project.",
          },
          name: { type: "string", minLength: 1, maxLength: 200 },
          description: { type: "string", maxLength: 65536 },
          startAt: { type: ["string", "null"], description: "YYYY-MM-DD." },
          dueAt: { type: ["string", "null"], description: "YYYY-MM-DD." },
          type: { enum: ["initiative", "epic", "task", "subtask"] },
          title: { type: "string", minLength: 1, maxLength: 200 },
          content: {
            type: "string",
            description: "wiki only: the exact Markdown, at most 16 KiB UTF-8.",
          },
        },
      },
    },
    links: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "from", "to"],
        properties: {
          type: { enum: ["parent", "milestone", "dependency"] },
          from: KEY,
          to: KEY,
          linkType: {
            enum: ["prerequisite", "follows", "blocks", "relates_to"],
            description: "dependency only.",
          },
        },
      },
    },
    assets: {
      type: "array",
      maxItems: 32,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "assetId"],
        properties: {
          path: {
            type: "string",
            minLength: 1,
            description:
              "Relative path below the manifest root that Markdown links use, without dot segments.",
          },
          assetId: { type: "string", minLength: 1, maxLength: 200 },
        },
      },
    },
    wiki: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["parentId"],
      properties: {
        project: {
          ...KEY,
          description: "Key of the project source for the pages.",
        },
        parentId: {
          type: ["string", "null"],
          minLength: 1,
          maxLength: 200,
          description: "Existing parent page ID, or null for the project root.",
        },
      },
    },
  },
};

/** Read-only, stateless preview of a structured import with every object, link and conflict. */
export const STRUCTURED_IMPORT_PLAN_TOOL: Tool = {
  name: "plan_structured_import",
  title: "Plan structured import",
  description:
    "Previews a structured import without writes, visits, uploads or external calls. The manifest names projects (existing IDs only, never created), milestones, tickets and Markdown wiki pages by key, links tickets to parents and milestones and milestones to each other, and maps relative asset paths to staged asset IDs from prepare_asset_upload. Returns every object with its action (create, unchanged, conflict, invalid, blocked), the links, the relative Markdown links that will point to an asset, the conflicts and errors, the effect on GitHub (publication follows the Pages setting of the project) and a SHA-256 fingerprint. Errors (missing reference, cycle, wrong parent type, unusable asset, missing right) must be fixed before apply. Hidden and missing projects, parents and pages return NOT_FOUND. Wiki: at most 32 files, 16 KiB each, 32 KiB in total; at most 100 sources, 200 links and 32 assets; 64 KiB whole request, 1 MiB response. Apply with apply_structured_import.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["manifest"],
    properties: { manifest: STRUCTURED_MANIFEST_SCHEMA },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
