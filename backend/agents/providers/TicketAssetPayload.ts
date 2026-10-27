import { ticketAssetLabel } from "@/backend/agents/TicketAssetInput";

import type { AgentTicketAssetContent } from "@/definition/AgentTicketParameter";

type ContentFormat = "google" | "anthropic" | "responses" | "completions";

function textBlock(
  format: ContentFormat,
  text: string,
): Readonly<Record<string, unknown>> {
  if (format === "google") return { text };
  return { type: format === "responses" ? "input_text" : "text", text };
}

function imageBlock(
  format: ContentFormat,
  content: Extract<
    AgentTicketAssetContent["content"],
    { readonly type: "image" }
  >,
): Readonly<Record<string, unknown>> {
  if (format === "google")
    return { inlineData: { mimeType: content.mimeType, data: content.base64 } };
  if (format === "anthropic")
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: content.mimeType,
        data: content.base64,
      },
    };
  const url = `data:${content.mimeType};base64,${content.base64}`;
  if (format === "responses") return { type: "input_image", image_url: url };
  return { type: "image_url", image_url: { url } };
}

/** Encodes real contents separately from the instruction, in the provider's native message format. */
export function ticketAssetPayload(
  format: ContentFormat,
  prompt: string,
  assets: readonly AgentTicketAssetContent[],
): readonly Readonly<Record<string, unknown>>[] {
  const blocks = [textBlock(format, prompt)];
  for (const asset of assets) {
    blocks.push(textBlock(format, ticketAssetLabel(asset)));
    blocks.push(
      asset.content.type === "image"
        ? imageBlock(format, asset.content)
        : textBlock(
            format,
            asset.content.type === "text"
              ? asset.content.text
              : `Original file only: ${asset.content.reason}. No model content available.`,
          ),
    );
  }
  return blocks;
}
