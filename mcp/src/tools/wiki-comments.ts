import type { Tool } from "@modelcontextprotocol/server";
import type { PagesAgentCommentOperation } from "../../../definition/PagesAgentOperations.js";

const IDENTIFIER = { type: "string", minLength: 1, maxLength: 200 } as const;
const BODY = { type: "string", minLength: 1, maxLength: 5000 } as const;
const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const ADDITIVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const DESTRUCTIVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const RIGHTS =
  "Anyone who can see the page may use this, also without the write right. A comment on a page you cannot see returns NOT_FOUND, like one that does not exist.";
const REPLAY =
  "Reuse operationId with identical input to recover the stored result after response loss; changed input returns CONFLICT. JSON request maximum 64 KiB.";
const AUTHOR =
  "Comments appear under the name of the connected account; Project activity records source=mcp.";

/** Reads the comments of one page. */
export const WIKI_COMMENTS_READ_TOOL: Tool = {
  name: "read_wiki_comments",
  title: "Read wiki comments",
  description: `Reads the comments of a visible wiki page as threads, oldest first, each with its replies: comment id, author display name, text, quoted passage and whether it is stale, resolved state, and whether the connected account may edit (canEdit) or delete (canDelete) it. Reply to a thread with the id of its first comment. pageId is a page ID or a Pages address such as /wiki/<id>. Missing and hidden pages both return NOT_FOUND. Responses are limited to 1 MiB UTF-8 JSON.`,
  inputSchema: {
    type: "object",
    properties: {
      pageId: IDENTIFIER,
      cursor: { type: ["string", "null"] },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
    required: ["pageId"],
    additionalProperties: false,
  },
  annotations: READ_ANNOTATIONS,
};

/** Adds a comment or a reply. */
export const WIKI_COMMENT_ADD_TOOL: Tool = {
  name: "add_wiki_comment",
  title: "Add wiki comment",
  description: `Adds a comment to a visible wiki page, or a reply to a first comment of the same page. body is trimmed, must not be empty and may have at most 5000 characters. Omit parentId to start a thread; to reply, pass the id of a first comment of this page (read_wiki_comments). A parent that is itself a reply or belongs to another page returns INVALID_REQUEST. quote is the passage of the page text the comment refers to (at most 500 characters); omit it for a comment on the page. Writing @username of an active account records a mention for that person in the "For me" area of the wiki when they can see the page, exactly as when a person types it; nothing is sent by mail or push, and private pages record no mentions. ${AUTHOR} ${RIGHTS} ${REPLAY}`,
  inputSchema: {
    type: "object",
    properties: {
      operationId: IDENTIFIER,
      pageId: IDENTIFIER,
      body: BODY,
      parentId: { type: ["string", "null"], maxLength: 200 },
      quote: { type: ["string", "null"], maxLength: 500 },
    },
    required: ["operationId", "pageId", "body"],
    additionalProperties: false,
  },
  annotations: ADDITIVE_ANNOTATIONS,
};

/** Changes the text of a comment. */
export const WIKI_COMMENT_EDIT_TOOL: Tool = {
  name: "edit_wiki_comment",
  title: "Edit wiki comment",
  description: `Replaces the text of a comment; only its author may do this, so the connected account can edit only comments it wrote. Someone else's comment returns FORBIDDEN. The previous text is not kept. body is trimmed, must not be empty and may have at most 5000 characters; a text that is already there is not written again (changed: false). Mentions follow the new text. ${RIGHTS} ${REPLAY}`,
  inputSchema: {
    type: "object",
    properties: { operationId: IDENTIFIER, commentId: IDENTIFIER, body: BODY },
    required: ["operationId", "commentId", "body"],
    additionalProperties: false,
  },
  annotations: DESTRUCTIVE_ANNOTATIONS,
};

/** Resolves a thread, or opens it again. */
export const WIKI_COMMENT_RESOLVE_TOOL: Tool = {
  name: "resolve_wiki_comment",
  title: "Resolve wiki comment",
  description: `Resolves the thread of a first comment (resolved: true) or opens it again (resolved: false). A thread that is already in that state is left as it is, with the person and time that resolved it (changed: false). A reply cannot be resolved and returns INVALID_REQUEST. ${RIGHTS} ${REPLAY}`,
  inputSchema: {
    type: "object",
    properties: {
      operationId: IDENTIFIER,
      commentId: IDENTIFIER,
      resolved: { type: "boolean" },
    },
    required: ["operationId", "commentId", "resolved"],
    additionalProperties: false,
  },
  annotations: ADDITIVE_ANNOTATIONS,
};

/** Deletes a comment with its replies. */
export const WIKI_COMMENT_DELETE_TOOL: Tool = {
  name: "delete_wiki_comment",
  title: "Delete wiki comment",
  description: `Deletes a comment together with all replies to it and their mentions; deletedComments says how many comments were removed. The author of a comment, the owner of the page and administrators (not on private pages) may delete it; anybody else gets FORBIDDEN, which read_wiki_comments shows beforehand as canDelete. Deleting cannot be undone. Ask the user to type LÖSCHEN (German) or DELETE (English) and pass that exact reply as confirmation; missing or wrong confirmation is rejected. ${RIGHTS} ${REPLAY}`,
  inputSchema: {
    type: "object",
    properties: {
      operationId: IDENTIFIER,
      commentId: IDENTIFIER,
      confirmation: { type: "string", enum: ["LÖSCHEN", "DELETE"] },
    },
    required: ["operationId", "commentId", "confirmation"],
    additionalProperties: false,
  },
  annotations: DESTRUCTIVE_ANNOTATIONS,
};

/** Fixed comment contracts; Pages offers them to every verified account, as seeing a page suffices. */
export const COMMENT_TOOLS: readonly {
  readonly operation: PagesAgentCommentOperation;
  readonly tool: Tool;
}[] = [
  { operation: "wiki.comments.read", tool: WIKI_COMMENTS_READ_TOOL },
  { operation: "wiki.comment.add", tool: WIKI_COMMENT_ADD_TOOL },
  { operation: "wiki.comment.edit", tool: WIKI_COMMENT_EDIT_TOOL },
  { operation: "wiki.comment.resolve", tool: WIKI_COMMENT_RESOLVE_TOOL },
  { operation: "wiki.comment.delete", tool: WIKI_COMMENT_DELETE_TOOL },
];
