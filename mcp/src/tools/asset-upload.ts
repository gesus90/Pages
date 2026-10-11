import type { Tool } from "@modelcontextprotocol/server";

/** Metadata-only capability request, usable even when the MCP transport is limited to 64 KiB. */
export const ASSET_UPLOAD_TOOL: Tool = {
  name: "prepare_asset_upload",
  title: "Prepare asset upload",
  description:
    "Requests a one-use five-minute binary upload ticket for a filename. Send raw bytes via POST to uploadPath on the configured Pages instance, with the ticket only in X-Pages-Upload-Ticket; do not send Authorization or place the ticket in a URL. Never put bytes or local file paths into MCP JSON. The binary response returns assetId and link. Unlinked assets expire after 24 hours. Current media/file limits are returned.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { fileName: { type: "string", maxLength: 255 } },
    required: ["fileName"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};
