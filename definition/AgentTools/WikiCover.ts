import { WIKI_COVER_PRESETS } from "../Wiki.js";
import {
  DESTRUCTIVE_ANNOTATIONS,
  IDENTIFIER_SCHEMA,
} from "./ToolDefinition.js";

import type { Tool } from "@modelcontextprotocol/server";

/**
 * Changes only the cover of one page.
 *
 * @remarks
 * The cover is visual page metadata and takes no `expectedRevision`: setting it
 * never changes the text, the revision or the page versions.
 */
export const WIKI_SET_COVER_TOOL: Tool = {
  name: "set_wiki_page_cover",
  title: "Set wiki page cover",
  description:
    'Sets, replaces or removes the cover of one wiki page; title, text, icon and place stay unchanged. cover is {"kind":"preset","preset":<name>} with preset one of sunrise, ocean, forest, dusk, slate or sand; {"kind":"attachment","attachmentId":<id>} for a JPEG, PNG, GIF or WebP image attachment of this same page (attachmentId as returned by create_wiki_page or an import); or null to remove the cover. read_wiki_page returns the cover in the same shape. A cover is visual page metadata: the Markdown, the revision and the page versions do not change, so no expectedRevision is taken. pageId is a page ID or a Pages address such as /wiki/<id> (with or without the server in front). Reuse operationId with identical input to recover the stored result after response loss; changed input returns CONFLICT. A hidden page returns NOT_FOUND; without the write right the call returns FORBIDDEN. An unknown preset, an attachment that is no image or does not belong to this page, and any other malformed cover return INVALID_REQUEST without further detail. JSON request maximum 64 KiB.',
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      operationId: IDENTIFIER_SCHEMA,
      pageId: IDENTIFIER_SCHEMA,
      cover: {
        type: ["object", "null"],
        additionalProperties: false,
        description:
          'null removes the cover. kind "preset" takes exactly preset; kind "attachment" takes exactly attachmentId.',
        properties: {
          kind: { type: "string", enum: ["preset", "attachment"] },
          preset: { type: "string", enum: [...WIKI_COVER_PRESETS] },
          attachmentId: { type: "string", minLength: 1, maxLength: 64 },
        },
        required: ["kind"],
      },
    },
    required: ["operationId", "pageId", "cover"],
  },
  annotations: DESTRUCTIVE_ANNOTATIONS,
};
