import { UPLOAD_ANNOTATIONS } from "./ToolDefinition.js";

import type { Tool } from "@modelcontextprotocol/server";

/** Metadata-only capability request, usable even when the MCP transport is limited to 64 KiB. */
export const ASSET_UPLOAD_TOOL: Tool = {
  name: "prepare_asset_upload",
  title: "Prepare asset upload",
  description:
    "Requests a one-use five-minute binary upload ticket for a filename. Send raw bytes via POST to uploadPath on the configured Pages instance, with the ticket only in X-Pages-Upload-Ticket; do not send Authorization or place the ticket in a URL. Never put bytes or local file paths into MCP JSON. For an existing ticket, pass its immutable ticketId: the binary upload is immediately attached and returns a permanent /aufgaben/attachments/ link with expiresAt null. Without ticketId the upload is staged (expires after 24 hours); saving it in a ticket description atomically promotes your own upload and rewrites its link. External image URLs and local paths are rejected: upload the image instead. Current media/file limits are returned. For an existing wiki page pass pageId instead of ticketId, together with operationId. For returned ticket/wiki results supply operationId and keep it for response-loss recovery: identical bytes/metadata return the same permanent link; changed input conflicts. sourceAttachmentId plus its expectedDigest records origin; sourceType selects ticket/wiki/agent when the origin differs from the destination. New derivatives may cross authorized destinations; replacements must stay on the selected owner. replace=true explicitly selects a replacement revision; it rejects a stale/already-replaced source and retains the original download. This never grants file editing rights; read-only and Pica profiles cannot upload. A raster change requires a real image editing tool; if absent, report it.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      fileName: { type: "string", maxLength: 255 },
      ticketId: { type: "string", format: "uuid" },
      pageId: { type: "string", format: "uuid" },
      operationId: {
        type: "string",
        maxLength: 100,
        pattern: "^[a-zA-Z0-9_-]+$",
      },
      sourceAttachmentId: { type: "string", format: "uuid" },
      sourceType: { type: "string", enum: ["ticket", "wiki", "agent"] },
      expectedDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
      replace: { type: "boolean" },
    },
    required: ["fileName"],
  },
  annotations: UPLOAD_ANNOTATIONS,
};
