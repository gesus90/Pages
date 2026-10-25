import { UPLOAD_ANNOTATIONS } from "./ToolDefinition.js";

import type { Tool } from "@modelcontextprotocol/server";

/** Metadata-only capability request, usable even when the MCP transport is limited to 64 KiB. */
export const ASSET_UPLOAD_TOOL: Tool = {
  name: "prepare_asset_upload",
  title: "Prepare asset upload",
  description:
    "Requests a one-use five-minute binary upload ticket for a filename. Send raw bytes via POST to uploadPath on the configured Pages instance, with the ticket only in X-Pages-Upload-Ticket; do not send Authorization or place the ticket in a URL. Never put bytes or local file paths into MCP JSON. For an existing ticket, pass its immutable ticketId: the binary upload is immediately attached and returns a permanent /aufgaben/attachments/ link with expiresAt null. Without ticketId the upload is staged (expires after 24 hours); saving it in a ticket description atomically promotes your own upload and rewrites its link. External image URLs and local paths are rejected: upload the image instead. Current media/file limits are returned.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      fileName: { type: "string", maxLength: 255 },
      ticketId: { type: "string", format: "uuid" },
    },
    required: ["fileName"],
  },
  annotations: UPLOAD_ANNOTATIONS,
};
