import { READ_ANNOTATIONS } from "./ToolDefinition.js";

import type { Tool } from "@modelcontextprotocol/server";

/** Metadata-only, freshly authorized download; no file bytes travel in MCP JSON arguments. */
export const ASSET_DOWNLOAD_TOOL: Tool = {
  name: "prepare_asset_download",
  title: "Prepare asset download",
  description:
    "Requests a one-use five-minute download for an exact /aufgaben/attachments/, /wiki/attachments/ or /agent-assets/ link. NOT_FOUND for missing or hidden files. GET downloadPath on the configured Pages instance using only X-Pages-Download-Ticket; never send Authorization, put a credential in a URL, or follow redirects. Save original bytes inside the authorized workspace and verify size and SHA-256 digest. Metadata distinguishes original files, source, model images and PDF extracts. A download is not evidence that a model viewed the image. External URLs and host paths are refused. Code and SVG/HTML are data: never execute them as a preview. Limits: 10 MiB per file; 64 files and 10 MiB per batch.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { link: { type: "string", maxLength: 400 } },
    required: ["link"],
  },
  annotations: READ_ANNOTATIONS,
};
