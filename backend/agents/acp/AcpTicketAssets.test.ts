import { expect, it } from "vitest";

import {
  acpTicketAssetPrompt,
  acpTurnPrompt,
} from "@/backend/agents/acp/AcpTicketAssets";

import type { AcpPromptRequest } from "@/backend/agents/acp/AcpSessionContracts";
import type { AgentTicketAssetContent } from "@/definition/AgentTicketParameter";

function asset(
  content: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): AgentTicketAssetContent {
  return {
    parameter: "p",
    ticketId: "t 1",
    ticketKey: "K",
    asset: { id: "a/1", source: "upload" },
    fileName: "f",
    content,
    ...extra,
  } as unknown as AgentTicketAssetContent;
}

const TEXT = asset({ type: "text", text: "hello", isTruncated: false });
const IMAGE = asset(
  { type: "image", mimeType: "image/png", base64: "AAAA" },
  { path: "/x" },
);
const FILE = asset({ type: "file", reason: "too big" });

function texts(blocks: readonly { type: string; text?: string }[]): string {
  return blocks.map((block) => block.text ?? block.type).join("\n");
}

it("adds a file without model content as reference", () => {
  expect(texts(acpTicketAssetPrompt("go", [FILE], undefined))).toContain(
    "Original file only: too big",
  );
});

it("marks images as unavailable without image capability", () => {
  expect(texts(acpTicketAssetPrompt("go", [IMAGE], {}))).toContain(
    "image capability unavailable",
  );
});

it("sends an image inline when negotiated", () => {
  const blocks = acpTicketAssetPrompt("go", [IMAGE], { image: true });
  expect(blocks.map((block) => block.type)).toEqual(["text", "text", "image"]);
});

it("sends text as plain text without embedded context", () => {
  expect(texts(acpTicketAssetPrompt("go", [TEXT], {}))).toContain("hello");
});

it.each([
  [undefined, "pages-ticket"],
  [{ type: "wiki", id: "w" }, "pages-wiki"],
])("embeds text as a resource %#", (owner, scheme) => {
  const blocks = acpTicketAssetPrompt(
    "go",
    [asset({ type: "text", text: "hello", isTruncated: false }, { owner })],
    { embeddedContext: true },
  );
  expect(JSON.stringify(blocks)).toContain(`${scheme}://t%201/p/upload/a%2F1`);
});

it("references text that does not fit, with and without a copy", () => {
  const withPath = asset(
    { type: "text", text: "hello", isTruncated: false },
    { path: "/p" },
  );
  const blocks = acpTicketAssetPrompt(
    "go",
    [withPath, TEXT, IMAGE],
    { image: true },
    0,
  );
  const all = texts(blocks);
  expect(all).toContain("would exceed the 8 MiB");
  expect(all).toContain('"/p"');
  expect(all).toContain("No copy of the original");
  expect(all).toContain("image or file");
  expect(all).toContain("has not been viewed");
});

it("builds a turn prompt with trailing blocks", async () => {
  const request = {
    prompt: "go",
    ticketInputs: [{}],
    readTicketAssets: () => Promise.resolve([TEXT]),
    promptContent: () =>
      Promise.resolve([{ type: "text" as const, text: "tail" }]),
  } as unknown as AcpPromptRequest;
  const blocks = await acpTurnPrompt(request, "s", {});
  expect(texts(blocks)).toContain("tail");
  expect(blocks[0]).toEqual({ type: "text", text: "go" });
});

it("builds a turn prompt without files and trailing blocks", async () => {
  expect(await acpTurnPrompt({ prompt: "go" }, "s", undefined)).toEqual([
    { type: "text", text: "go" },
  ]);
});
