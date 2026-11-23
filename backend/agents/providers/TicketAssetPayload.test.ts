import { expect, it } from "vitest";

import { ticketAssetPayload } from "@/backend/agents/providers/TicketAssetPayload";

import type { AgentTicketAssetContent } from "@/definition/AgentTicketParameter";

function asset(
  content: AgentTicketAssetContent["content"],
): AgentTicketAssetContent {
  return {
    parameter: "input",
    ticketId: "t1",
    ticketKey: "K-1",
    asset: { source: "ticket", id: "a1", link: "/a1" },
    fileName: "file",
    content,
  };
}

const image = asset({ type: "image", mimeType: "image/png", base64: "QQ==" });
const text = asset({ type: "text", text: "body" });
const file = asset({ type: "file", reason: "too-large" });

it("starts with the instruction in every native text block format", () => {
  expect(ticketAssetPayload("google", "go", [])).toEqual([{ text: "go" }]);
  expect(ticketAssetPayload("anthropic", "go", [])).toEqual([
    { type: "text", text: "go" },
  ]);
  expect(ticketAssetPayload("responses", "go", [])).toEqual([
    { type: "input_text", text: "go" },
  ]);
  expect(ticketAssetPayload("completions", "go", [])).toEqual([
    { type: "text", text: "go" },
  ]);
});

it("encodes an image in each provider's native format after its label", () => {
  const blockOf = (format: Parameters<typeof ticketAssetPayload>[0]): unknown =>
    ticketAssetPayload(format, "go", [image])[2];
  expect(blockOf("google")).toEqual({
    inlineData: { mimeType: "image/png", data: "QQ==" },
  });
  expect(blockOf("anthropic")).toEqual({
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "QQ==" },
  });
  expect(blockOf("responses")).toEqual({
    type: "input_image",
    image_url: "data:image/png;base64,QQ==",
  });
  expect(blockOf("completions")).toEqual({
    type: "image_url",
    image_url: { url: "data:image/png;base64,QQ==" },
  });
});

it("sends text contents and describes files that have no model content", () => {
  const blocks = ticketAssetPayload("google", "go", [text, file]);
  expect(blocks).toHaveLength(5);
  expect(blocks[2]).toEqual({ text: "body" });
  expect(blocks[4]).toEqual({
    text: "Original file only: too-large. No model content available.",
  });
});
