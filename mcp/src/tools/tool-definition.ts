import { PROJECT_DELETION_CONFIRMATIONS } from "../../../definition/AgentProjectDeletion.js";

import type { Tool } from "@modelcontextprotocol/server";

/** Named argument schemas of a strict tool input. */
export type ToolProperties = NonNullable<Tool["inputSchema"]["properties"]>;
/** One JSON Schema argument, including nested schema compositions. */
export type PropertySchema = ToolProperties[string];

/** Public identifiers and references validated by Pages' operation readers. */
export const IDENTIFIER_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 200,
} as const;
/** Internal plan graph identifiers retain the editor's stricter limit. */
export const PLAN_NODE_IDENTIFIER_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 100,
} as const;
/** Explicitly clears an optional reference. */
export const NULLABLE_IDENTIFIER_SCHEMA = {
  type: ["string", "null"],
  minLength: 1,
  maxLength: 200,
} satisfies PropertySchema;
/** Opaque continuation, validated by Pages' shared cursor reader. */
export const CURSOR_SCHEMA = {
  type: ["string", "null"],
  maxLength: 2048,
} satisfies PropertySchema;
/** All cursor-based list operations accept one to one hundred results. */
export const LIMIT_SCHEMA = {
  type: "integer",
  minimum: 1,
  maximum: 100,
} as const;
/** Common list arguments; the original query must accompany its continuation. */
export const PAGING_PROPERTIES = { cursor: CURSOR_SCHEMA, limit: LIMIT_SCHEMA };
/** A saved revision that a write compares before committing. */
export const REVISION_SCHEMA = { type: "integer", minimum: 1 } as const;
/** Editor coordinates for plan nodes and inserted templates. */
export const COORDINATE_SCHEMA = {
  type: "integer",
  minimum: 0,
  maximum: 6000,
} as const;
/** Confirmation accepted by Pages for project, wiki and archive deletions. */
export const CONFIRMATION_SCHEMA = {
  type: "string",
  enum: [...PROJECT_DELETION_CONFIRMATIONS],
};
/** Session deletion accepts the same German word in both terminal languages. */
export const CHAT_CONFIRMATIONS = ["LÖSCHEN"] as const;
/** Explicit own-session deletion confirmation, without an English alias. */
export const CHAT_CONFIRMATION_SCHEMA = {
  type: "string",
  enum: [...CHAT_CONFIRMATIONS],
};

/** Reads have no side effects beyond retrieving Pages records. */
export const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
/** Journaled additive writes have no further effect when replayed. */
export const ADDITIVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
/** Journaled replacements and removals retain the same replay guarantee. */
export const DESTRUCTIVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;
/** Preparing a one-use upload ticket produces a fresh capability each time. */
export const UPLOAD_ANNOTATIONS = {
  ...ADDITIVE_ANNOTATIONS,
  idempotentHint: false,
} as const;
/** Own-session deletion is explicit and has no journaled replay. */
export const SESSION_DELETION_ANNOTATIONS = {
  ...DESTRUCTIVE_ANNOTATIONS,
  idempotentHint: false,
} as const;

interface ToolOptions {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly properties: ToolProperties;
}

interface ReadToolOptions extends ToolOptions {
  readonly required?: readonly string[];
}

interface WriteToolOptions extends ToolOptions {
  readonly optionalKeys?: readonly string[];
  readonly isDestructive: boolean;
  /** Execution may invoke models or affect a workspace beyond Pages records. */
  readonly isOpenWorld?: boolean;
}

/** Builds a static read contract without introducing client-side validation. */
export function buildReadTool(options: ReadToolOptions): Tool {
  return {
    name: options.name,
    title: options.title,
    description: options.description,
    inputSchema: {
      type: "object",
      properties: options.properties,
      ...(options.required === undefined
        ? {}
        : { required: [...options.required] }),
      additionalProperties: false,
    },
    annotations: READ_ANNOTATIONS,
  };
}

/** Builds a journaled write with explicit replacement/removal and execution hints. */
export function buildWriteTool(options: WriteToolOptions): Tool {
  const optionalKeys = options.optionalKeys ?? [];
  return {
    name: options.name,
    title: options.title,
    description: options.description,
    inputSchema: {
      type: "object",
      properties: { operationId: IDENTIFIER_SCHEMA, ...options.properties },
      required: [
        "operationId",
        ...Object.keys(options.properties).filter(
          (key) => !optionalKeys.includes(key),
        ),
      ],
      additionalProperties: false,
    },
    annotations: {
      ...(options.isDestructive
        ? DESTRUCTIVE_ANNOTATIONS
        : ADDITIVE_ANNOTATIONS),
      openWorldHint: options.isOpenWorld ?? false,
    },
  };
}
