import { expect, it } from "vitest";

import { acpTicketAssetPrompt } from "@/backend/agents/acp/AcpTicketAssets";
import { ticketAssetLabel } from "@/backend/agents/TicketAssetInput";

import type { AgentTicketAssetContent } from "@/definition/AgentTicketParameter";

function asset(
  content: AgentTicketAssetContent["content"],
  owner?: AgentTicketAssetContent["owner"],
): AgentTicketAssetContent {
  return {
    parameter: "my ticket",
    ticketId: "t/1",
    ticketKey: "PAGE-1",
    asset: { source: "ticket", id: "a 1", link: "/a" },
    fileName: "file",
    ...(owner === undefined ? {} : { owner }),
    content,
  };
}

const IMAGE = asset({ type: "image", mimeType: "image/png", base64: "AA==" });
const FILE = asset({ type: "file", reason: "binary archive" });
const TEXT = asset({ type: "text", text: "contents" });
const WIKI_TEXT = asset(
  { type: "text", text: "wiki" },
  { type: "wiki", id: "w" },
);

it("starts with the prompt text alone without assets", () => {
  expect(acpTicketAssetPrompt("Do it", [], null)).toEqual([
    { type: "text", text: "Do it" },
  ]);
});

it("sends native images and embedded resources when the adapter negotiated them", () => {
  const blocks = acpTicketAssetPrompt("Do it", [IMAGE, TEXT, WIKI_TEXT], {
    image: true,
    embeddedContext: true,
  });

  expect(blocks).toEqual([
    { type: "text", text: "Do it" },
    { type: "text", text: ticketAssetLabel(IMAGE) },
    { type: "image", mimeType: "image/png", data: "AA==" },
    { type: "text", text: ticketAssetLabel(TEXT) },
    {
      type: "resource",
      resource: {
        uri: "pages-ticket://t%2F1/my%20ticket/ticket/a%201",
        mimeType: "text/plain",
        text: "contents",
      },
    },
    { type: "text", text: ticketAssetLabel(WIKI_TEXT) },
    {
      type: "resource",
      resource: {
        uri: "pages-wiki://t%2F1/my%20ticket/ticket/a%201",
        mimeType: "text/plain",
        text: "wiki",
      },
    },
  ]);
});

it("falls back to notes and plain text without negotiated capabilities", () => {
  const blocks = acpTicketAssetPrompt("Do it", [IMAGE, FILE, TEXT], undefined);

  expect(blocks.slice(1)).toEqual([
    { type: "text", text: ticketAssetLabel(IMAGE) },
    {
      type: "text",
      text: "Model image capability unavailable. Original file only; no image has been viewed. Use an authorized image tool if the task requires it.",
    },
    { type: "text", text: ticketAssetLabel(FILE) },
    {
      type: "text",
      text: "Original file only: binary archive. No model content available.",
    },
    { type: "text", text: ticketAssetLabel(TEXT) },
    { type: "text", text: "contents" },
  ]);
});
