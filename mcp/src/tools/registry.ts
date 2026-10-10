import type { Tool } from "@modelcontextprotocol/server";
import type { PagesAgentReadOperation } from "../../../definition/PagesAgentOperations.js";

interface ReadTool {
  readonly operation: PagesAgentReadOperation;
  readonly tool: Tool;
}

const ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const TEXT = { type: "string", minLength: 1, maxLength: 200 } as const;

/** Fixed read-only tool descriptions; Pages determines which operations an identity may use. */
export const READ_TOOLS: readonly ReadTool[] = [
  {
    operation: "projects.resolve",
    tool: {
      name: "resolve_project",
      title: "Resolve project",
      description:
        "Resolves an exact trimmed case-sensitive project name. Multiple matches return AMBIGUOUS with at most 100 visible candidates; no target is chosen. Responses are limited to 1 MiB UTF-8 JSON.",
      inputSchema: {
        type: "object",
        properties: { name: TEXT },
        required: ["name"],
        additionalProperties: false,
      },
      annotations: ANNOTATIONS,
    },
  },
  {
    operation: "projects.read",
    tool: {
      name: "read_project",
      title: "Read project",
      description:
        "Reads the core details of a visible active project by ID. Missing and hidden projects both return NOT_FOUND. Responses are limited to 1 MiB UTF-8 JSON.",
      inputSchema: {
        type: "object",
        properties: { projectId: TEXT },
        required: ["projectId"],
        additionalProperties: false,
      },
      annotations: ANNOTATIONS,
    },
  },
  {
    operation: "wiki.page.read",
    tool: {
      name: "read_wiki_page",
      title: "Read wiki page",
      description:
        "Reads complete Markdown and revision of a visible page without recording a visit. Hidden/private placeholders return NOT_FOUND. Responses over 1 MiB UTF-8 JSON return PAYLOAD_TOO_LARGE.",
      inputSchema: {
        type: "object",
        properties: { pageId: TEXT },
        required: ["pageId"],
        additionalProperties: false,
      },
      annotations: ANNOTATIONS,
    },
  },
  {
    operation: "wiki.tree.read",
    tool: {
      name: "read_wiki_tree",
      title: "Read wiki tree",
      description:
        "Lists at most 100 visible wiki nodes, optionally in a visible project. Includes visible total and truncated; parents outside the returned window are null. Responses are limited to 1 MiB UTF-8 JSON.",
      inputSchema: {
        type: "object",
        properties: { projectId: TEXT },
        additionalProperties: false,
      },
      annotations: ANNOTATIONS,
    },
  },
  {
    operation: "wiki.search",
    tool: {
      name: "search_wiki",
      title: "Search wiki",
      description:
        "Searches visible wiki titles and Markdown, optionally in a visible project. At most 20 hits, snippets at most 200 Unicode characters, visible total and truncated. Responses are limited to 1 MiB UTF-8 JSON.",
      inputSchema: {
        type: "object",
        properties: { text: TEXT, projectId: TEXT },
        required: ["text"],
        additionalProperties: false,
      },
      annotations: ANNOTATIONS,
    },
  },
];
