import { AgentError } from "@/backend/error/AgentErrors";
import { ticketAssetLabel } from "@/backend/agents/TicketAssetInput";

import type {
  ContentBlock,
  PromptCapabilities,
} from "@agentclientprotocol/sdk";
import type { AgentTicketAssetContent } from "@/definition/AgentTicketParameter";

/** Sends complete resources, checking the adapter's negotiated image support before any prompt. */
export function acpTicketAssetPrompt(
  prompt: string,
  assets: readonly AgentTicketAssetContent[],
  capabilities: PromptCapabilities | null | undefined,
): ContentBlock[] {
  const blocks: ContentBlock[] = [{ type: "text", text: prompt }];
  for (const asset of assets) {
    blocks.push({ type: "text", text: ticketAssetLabel(asset) });
    if (asset.content.type === "image") {
      if (!capabilities?.image)
        throw new AgentError("parameter_asset_transfer_unsupported");
      blocks.push({
        type: "image",
        mimeType: asset.content.mimeType,
        data: asset.content.base64,
      });
    } else if (capabilities?.embeddedContext) {
      blocks.push({
        type: "resource",
        resource: {
          uri: `pages-ticket://${encodeURIComponent(asset.ticketId)}/${encodeURIComponent(asset.parameter)}/${asset.asset.source}/${encodeURIComponent(asset.asset.id)}`,
          mimeType: "text/plain",
          text: asset.content.text,
        },
      });
    } else {
      blocks.push({ type: "text", text: asset.content.text });
    }
  }
  return blocks;
}
