import {
  IDENTIFIER_SCHEMA,
  buildReadTool,
  buildWriteTool,
} from "./ToolDefinition.js";

import type { ToolProperties } from "./ToolDefinition.js";
import type { AgentFileOperation } from "../AgentFileOperations.js";
import type { Tool } from "@modelcontextprotocol/server";

const COMMIT = { type: "string", pattern: "^[a-fA-F0-9]{7,40}$" } as const;
const PAGE = { type: "integer", minimum: 1, maximum: 10000 } as const;
const LIMIT = { type: "integer", minimum: 1, maximum: 100 } as const;
const NAME = { type: "string", minLength: 1, maxLength: 255 } as const;
const TEXT = { type: "string", maxLength: 50000 } as const;

function read(
  operation: AgentFileOperation,
  properties: ToolProperties,
  required: readonly string[] = [],
): { readonly operation: AgentFileOperation; readonly tool: Tool } {
  return {
    operation,
    tool: buildReadTool({
      name: operation.replace(".", "_"),
      title: operation,
      description:
        "Reads files of the acting account's released Storage folders or visible project repository. Pages checks current rights; no checkout or project credential is returned.",
      properties,
      required,
    }),
  };
}

/** Storage reads and repository tools of the existing step-bound bridge. */
export const FILE_READ_TOOLS = [
  read(
    "repository.log",
    {
      projectId: IDENTIFIER_SCHEMA,
      range: {
        type: "string",
        pattern: "^[a-fA-F0-9]{7,40}\\.\\.[a-fA-F0-9]{7,40}$",
      },
      commit: COMMIT,
      page: PAGE,
      limit: LIMIT,
    },
    ["projectId"],
  ),
  read(
    "repository.diff",
    { projectId: IDENTIFIER_SCHEMA, base: COMMIT, head: COMMIT },
    ["projectId", "base", "head"],
  ),
  read(
    "repository.show",
    { projectId: IDENTIFIER_SCHEMA, commit: COMMIT, page: PAGE, limit: LIMIT },
    ["projectId", "commit"],
  ),
  read(
    "repository.file",
    {
      projectId: IDENTIFIER_SCHEMA,
      commit: COMMIT,
      path: { type: "string", minLength: 1, maxLength: 4096 },
    },
    ["projectId", "commit", "path"],
  ),
  read("storage.capabilities", {}),
  read("storage.list", {
    ref: IDENTIFIER_SCHEMA,
    pageSize: LIMIT,
    pageToken: { type: "string", maxLength: 2048 },
  }),
  read(
    "storage.search",
    {
      query: { type: "string", minLength: 1, maxLength: 200 },
      folderRef: IDENTIFIER_SCHEMA,
      pageSize: LIMIT,
      pageToken: { type: "string", maxLength: 2048 },
    },
    ["query", "folderRef"],
  ),
  read("storage.stat", { ref: IDENTIFIER_SCHEMA }, ["ref"]),
  read(
    "storage.resolve_path",
    { path: { type: "string", minLength: 1, maxLength: 4096 } },
    ["path"],
  ),
  read(
    "storage.read",
    { ref: IDENTIFIER_SCHEMA, format: { type: "string", maxLength: 200 } },
    ["ref"],
  ),
];

function write(
  operation: AgentFileOperation,
  properties: ToolProperties,
  optionalKeys: readonly string[],
): { readonly operation: AgentFileOperation; readonly tool: Tool } {
  return {
    operation,
    tool: buildWriteTool({
      name: operation.replace(".", "_"),
      title: operation,
      description:
        "Writes in a released Storage folder as the acting account, without admin mode. Current folder rights are checked even on receipt replay. Use a new operationId for a new version or confirmation. A pending receipt is CONFLICT, never an automatic second upload.",
      properties,
      optionalKeys,
      isDestructive: operation === "storage.update",
      isOpenWorld: true,
    }),
  };
}

const CONTENT = {
  content: TEXT,
  encoding: { type: "string", enum: ["text", "base64"] },
  mimeType: { type: "string", minLength: 1, maxLength: 200 },
};
/** Writes with durable pending/completed receipts, so response loss cannot silently duplicate uploads. */
export const FILE_WRITE_TOOLS = [
  write(
    "storage.create_folder",
    {
      parentRef: IDENTIFIER_SCHEMA,
      name: NAME,
      onConflict: { type: "string", enum: ["fail", "keep_both"] },
    },
    ["onConflict"],
  ),
  write(
    "storage.upload",
    {
      parentRef: IDENTIFIER_SCHEMA,
      name: NAME,
      ...CONTENT,
      onConflict: { type: "string", enum: ["fail", "keep_both", "overwrite"] },
      confirmation: IDENTIFIER_SCHEMA,
    },
    ["onConflict", "confirmation"],
  ),
  write(
    "storage.update",
    { ref: IDENTIFIER_SCHEMA, ...CONTENT, confirmation: IDENTIFIER_SCHEMA },
    ["confirmation"],
  ),
];
