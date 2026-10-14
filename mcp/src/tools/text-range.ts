import type { Tool } from "@modelcontextprotocol/server";

const IDENTIFIER = { type: "string", minLength: 1, maxLength: 200 } as const;
const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const COUNTER = { type: "integer", minimum: 1 } as const;

type PropertySchema = NonNullable<Tool["inputSchema"]["properties"]>[string];

// A read may leave the column out, which is column 1.
const READ_POSITION: PropertySchema = {
  type: "object",
  properties: { line: COUNTER, column: COUNTER },
  required: ["line"],
  additionalProperties: false,
};
const PATCH_POSITION: PropertySchema = {
  type: "object",
  properties: { line: COUNTER, column: COUNTER },
  required: ["line", "column"],
  additionalProperties: false,
};
const POSITIONS =
  "Positions are {line, column}, both starting at 1; start is inclusive, end exclusive. A column counts Unicode code points; a line break (LF, CRLF or CR) is one column at the end of its line, so the position after it is column 1 of the next line.";
const READ_COMMON =
  "column defaults to 1. Without end it reads at most maxCharacters (default 4096, at most 16384) and reports truncated and next; with end, a longer passage returns PAYLOAD_TOO_LARGE. A position outside the text returns INVALID_REQUEST with a reason. Returns the passage, its absolute start and end, and lineCount, characterCount and byteCount of the whole text, never the whole text.";
const PATCH_COMMON =
  "expectedText must equal the text of start..end exactly; use start equal to end with an empty expectedText to insert, and an empty replacementText to delete. replacementText is inserted verbatim and everything outside the range stays as it is. Other text in the range or an outdated version returns CONFLICT and nothing changes. Returns {changed, start, end} of the replacement in the new text; includeAfter true adds that passage as after (at most 4096 characters), never the whole text. Reuse operationId with identical input to recover the stored result; changed input returns CONFLICT. A hidden target returns NOT_FOUND; without the write right the call returns FORBIDDEN. JSON request maximum 64 KiB.";

function readSchema(target: string): Tool["inputSchema"] {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      [target]: IDENTIFIER,
      start: READ_POSITION,
      end: READ_POSITION,
      maxCharacters: {
        type: "integer",
        minimum: 1,
        maximum: 16384,
      },
    },
    required: [target, "start"],
  };
}

function patchSchema(target: string, version: string): Tool["inputSchema"] {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      operationId: IDENTIFIER,
      [target]: IDENTIFIER,
      [version]:
        version === "expectedRevision"
          ? { type: "integer", minimum: 1 }
          : { type: "string", minLength: 32, maxLength: 32 },
      start: PATCH_POSITION,
      end: PATCH_POSITION,
      expectedText: { type: "string" },
      replacementText: { type: "string" },
      includeAfter: { type: "boolean" },
    },
    required: [
      "operationId",
      target,
      version,
      "start",
      "end",
      "expectedText",
      "replacementText",
    ],
  };
}

/** Reads one passage of the Markdown of a wiki page. */
export const WIKI_READ_RANGE_TOOL: Tool = {
  name: "read_wiki_page_range",
  title: "Read wiki page range",
  description: `Reads only one passage of the Markdown of a visible wiki page, without recording a visit. pageId is a page ID or a Pages address such as /wiki/<id>. ${POSITIONS} ${READ_COMMON} Also returns revision: pass it as expectedRevision to patch_wiki_page_content.`,
  inputSchema: readSchema("pageId"),
  annotations: READ_ANNOTATIONS,
};

/** Reads one passage of the description of a ticket. */
export const TICKET_READ_DESCRIPTION_RANGE_TOOL: Tool = {
  name: "read_ticket_description_range",
  title: "Read ticket description range",
  description: `Reads only one passage of the description of a visible ticket. ticketId is a ticket ID, a key such as PAGE-12, or a Pages address. ${POSITIONS} ${READ_COMMON} Also returns descriptionVersion (the first 128 bits of the SHA-256 of the stored description, 32 hex digits): pass it as expectedDescriptionVersion to patch_ticket_description.`,
  inputSchema: readSchema("ticketId"),
  annotations: READ_ANNOTATIONS,
};

/** Replaces exactly one range of the Markdown of a wiki page. */
export const WIKI_PATCH_CONTENT_TOOL: Tool = {
  name: "patch_wiki_page_content",
  title: "Patch wiki page content",
  description: `Replaces exactly one range of the Markdown of a wiki page without sending the whole text; title, icon and place stay unchanged and the previous text stays in the page versions. pageId is a page ID or a Pages address such as /wiki/<id>. expectedRevision is the revision from read_wiki_page_range; a page saved since then returns CONFLICT with currentRevision. Positions as in read_wiki_page_range. ${PATCH_COMMON} The Markdown may not exceed 1 MiB UTF-8 after the change.`,
  inputSchema: patchSchema("pageId", "expectedRevision"),
  annotations: WRITE_ANNOTATIONS,
};

/** Replaces exactly one range of the description of a ticket. */
export const TICKET_PATCH_DESCRIPTION_TOOL: Tool = {
  name: "patch_ticket_description",
  title: "Patch ticket description",
  description: `Replaces exactly one range of the description of a ticket without sending the whole text; title, status, parent and milestone stay unchanged. ticketId is a ticket ID, a key such as PAGE-12, or a Pages address. expectedDescriptionVersion is the descriptionVersion from read_ticket_description_range; a description saved since then returns CONFLICT. Positions as in read_ticket_description_range. ${PATCH_COMMON} The description may not exceed 65,536 UTF-16 code units after the change and is stored as composed, not trimmed. Whether the change is published to GitHub follows the Pages setting of the project.`,
  inputSchema: patchSchema("ticketId", "expectedDescriptionVersion"),
  annotations: WRITE_ANNOTATIONS,
};
