import { methods } from "@agentclientprotocol/sdk";

import {
  readTicketAssetInput,
  ticketAssetLabel,
} from "@/backend/agents/TicketAssetInput";

import {
  ACP_MESSAGE_BUDGET_BYTES,
  acpBlockBytes,
  acpPromptRoom,
} from "./AcpPromptBudget";

import type {
  ContentBlock,
  PromptCapabilities,
} from "@agentclientprotocol/sdk";
import type { AcpPromptRequest } from "./AcpSessionContracts";
import type { AgentTicketAssetContent } from "@/definition/AgentTicketParameter";

/** Names in the file label why a model representation is not part of the prompt. */
const PROMPT_BUDGET_REASON = "prompt-budget-exceeded";

/** The two ways one file can appear in the prompt. */
interface AssetBlocks {
  /** Label and complete model content; `null` when the model cannot take any. */
  readonly inline: readonly ContentBlock[] | null;
  /** Label and a short note; the original file carries the content. */
  readonly reference: readonly ContentBlock[];
}

/**
 * The complete first prompt of a turn, first or continued, within the message budget.
 *
 * @param request - The instruction, the files of the step and the blocks that follow them.
 * @param sessionId - The protocol session the prompt is sent to.
 * @param capabilities - The prompt capabilities the adapter negotiated.
 * @returns The instruction, the inventory with the file contents that fit, then the following blocks.
 *
 * @remarks
 * The blocks after the files, such as chat attachments, are always sent;
 * file contents get the room the complete message leaves, and the verified
 * originals carry the rest.
 */
export async function acpTurnPrompt(
  request: AcpPromptRequest,
  sessionId: string,
  capabilities: PromptCapabilities | null | undefined,
): Promise<ContentBlock[]> {
  const assets = await readTicketAssetInput(request);
  const trailing = (await request.promptContent?.(capabilities)) ?? [];
  const room = acpPromptRoom({
    method: methods.agent.session.prompt,
    params: { sessionId, prompt: trailing },
  });
  return [
    ...acpTicketAssetPrompt(request.prompt, assets, capabilities, room),
    ...trailing,
  ];
}

/**
 * Builds the prompt of a turn: the instruction, then every file of the step.
 *
 * @param prompt - The complete instruction, sent unchanged as the first block.
 * @param assets - The authorized files of the step, each with its verified session copy.
 * @param capabilities - The prompt capabilities the adapter negotiated.
 * @param roomBytes - The UTF-8 bytes the blocks may take in the serialized message.
 * @returns The prompt blocks.
 *
 * @remarks
 * The instruction and the complete inventory come first: every file keeps its
 * provenance label. A model representation is added only while it fits
 * completely into the remaining room, in the order of the files; any other
 * file is marked as not inline and reached through its original. Nothing is
 * cut, shortened or left out. Whether the result fits as a whole is checked
 * once more on the complete message before it is sent.
 */
export function acpTicketAssetPrompt(
  prompt: string,
  assets: readonly AgentTicketAssetContent[],
  capabilities: PromptCapabilities | null | undefined,
  roomBytes: number = ACP_MESSAGE_BUDGET_BYTES,
): ContentBlock[] {
  const choices = assets.map((asset) => assetBlocks(asset, capabilities));
  const blocks: ContentBlock[] = [{ type: "text", text: prompt }];
  let room =
    roomBytes -
    blocksBytes(blocks) -
    choices.reduce((sum, choice) => sum + blocksBytes(choice.reference), 0);
  for (const choice of choices) {
    const extra = choice.inline
      ? blocksBytes(choice.inline) - blocksBytes(choice.reference)
      : 0;
    if (choice.inline && extra <= room) {
      room -= extra;
      blocks.push(...choice.inline);
    } else blocks.push(...choice.reference);
  }
  return blocks;
}

function blocksBytes(blocks: readonly ContentBlock[]): number {
  return blocks.reduce((sum, block) => sum + acpBlockBytes(block), 0);
}

/** Checks the adapter's negotiated image support before any prompt. */
function assetBlocks(
  asset: AgentTicketAssetContent,
  capabilities: PromptCapabilities | null | undefined,
): AssetBlocks {
  const label: ContentBlock = { type: "text", text: ticketAssetLabel(asset) };
  if (asset.content.type === "image" && !capabilities?.image)
    return {
      inline: null,
      reference: [
        label,
        {
          type: "text",
          text: "Model image capability unavailable. Original file only; no image has been viewed. Use an authorized image tool if the task requires it.",
        },
      ],
    };
  if (asset.content.type === "file")
    return {
      inline: null,
      reference: [
        label,
        {
          type: "text",
          text: `Original file only: ${asset.content.reason}. No model content available.`,
        },
      ],
    };
  return {
    inline: [label, inlineContent(asset, asset.content, capabilities)],
    reference: budgetReference(asset),
  };
}

function inlineContent(
  asset: AgentTicketAssetContent,
  content: Exclude<AgentTicketAssetContent["content"], { type: "file" }>,
  capabilities: PromptCapabilities | null | undefined,
): ContentBlock {
  if (content.type === "image")
    return { type: "image", mimeType: content.mimeType, data: content.base64 };
  if (!capabilities?.embeddedContext)
    return { type: "text", text: content.text };
  return {
    type: "resource",
    resource: {
      uri: `${asset.owner?.type === "wiki" ? "pages-wiki" : "pages-ticket"}://${encodeURIComponent(asset.ticketId)}/${encodeURIComponent(asset.parameter)}/${asset.asset.source}/${encodeURIComponent(asset.asset.id)}`,
      mimeType: "text/plain",
      text: content.text,
    },
  };
}

/** A file whose content does not fit: its label says so, and the note names the original. */
function budgetReference(asset: AgentTicketAssetContent): ContentBlock[] {
  const isImage = asset.content.type === "image";
  const access = asset.path
    ? `The complete, unchanged original is available in this session at ${JSON.stringify(asset.path)}; open it with an authorized ${isImage ? "image or file" : "file"} tool when the task needs it.`
    : "No copy of the original is available as a file in this session.";
  return [
    {
      type: "text",
      text: ticketAssetLabel({
        ...asset,
        content: { type: "file", reason: PROMPT_BUDGET_REASON },
      }),
    },
    {
      type: "text",
      text: `Not inline: this ${isImage ? "image" : "text"} would exceed the 8 MiB limit of the ACP prompt message, so its content is not part of this prompt${isImage ? " and the image has not been viewed" : ""}. ${access}`,
    },
  ];
}
