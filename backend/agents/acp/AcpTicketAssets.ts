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
      if (!capabilities?.image) {
        blocks.push({
          type: "text",
          text: "Model image capability unavailable. Original file only; no image has been viewed. Use an authorized image tool if the task requires it.",
        });
        continue;
      }
      blocks.push({
        type: "image",
        mimeType: asset.content.mimeType,
        data: asset.content.base64,
      });
    } else if (asset.content.type === "file") {
      blocks.push({
        type: "text",
        text: `Original file only: ${asset.content.reason}. No model content available.`,
      });
    } else if (capabilities?.embeddedContext) {
      blocks.push({
        type: "resource",
        resource: {
          uri: `${asset.owner?.type === "wiki" ? "pages-wiki" : "pages-ticket"}://${encodeURIComponent(asset.ticketId)}/${encodeURIComponent(asset.parameter)}/${asset.asset.source}/${encodeURIComponent(asset.asset.id)}`,
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
