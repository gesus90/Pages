import { expect, it, vi } from "vitest";

import {
  readTicketAssetInput,
  ticketAssetLabel,
} from "@/backend/agents/TicketAssetInput";

import type {
  AgentTicketAssetContent,
  AgentTicketInput,
} from "@/definition/AgentTicketParameter";

const TICKET_INPUT: AgentTicketInput = {
  parameter: "ticket",
  ticket: {
    id: "t-1",
    key: "PAGE-1",
    title: "Title",
    description: "",
    assets: [],
    markdown: "",
    version: "1",
  },
};

const BASE: Omit<AgentTicketAssetContent, "content"> = {
  parameter: "ticket",
  ticketId: "t-1",
  ticketKey: "PAGE-1",
  asset: { source: "ticket", id: "a-1", link: "/a-1" },
  fileName: "notes.md",
};

it("needs no reader when no ticket is forwarded", async () => {
  await expect(readTicketAssetInput({})).resolves.toEqual([]);
  await expect(readTicketAssetInput({ ticketInputs: [] })).resolves.toEqual([]);
});

it("refuses forwarded tickets without a live reader", async () => {
  await expect(
    readTicketAssetInput({ ticketInputs: [TICKET_INPUT] }),
  ).rejects.toMatchObject({ code: "parameter_asset_transfer_unsupported" });
});

it("returns the contents of the live reader", async () => {
  const assets = [
    { ...BASE, content: { type: "file" as const, reason: "binary" } },
  ];
  const readTicketAssets = vi.fn(async () => assets);

  await expect(
    readTicketAssetInput({ ticketInputs: [TICKET_INPUT], readTicketAssets }),
  ).resolves.toBe(assets);
});

it("labels a truncated text original with its representation", () => {
  const label = ticketAssetLabel({
    ...BASE,
    owner: { type: "ticket", id: "t-1" },
    original: { mimeType: "text/markdown", size: 4, digest: "d" },
    path: "/work/notes.md",
    content: { type: "text", text: "abcd", isTruncated: true },
  });

  expect(JSON.parse(label)).toEqual({
    parameter: "ticket",
    ticketId: "t-1",
    ticketKey: "PAGE-1",
    asset: BASE.asset,
    fileName: "notes.md",
    owner: { type: "ticket", id: "t-1" },
    original: { mimeType: "text/markdown", size: 4, digest: "d" },
    path: "/work/notes.md",
    representation: "source",
    isTruncated: true,
  });
});

it("labels a file without an original with its model content reason", () => {
  const label = ticketAssetLabel({
    ...BASE,
    content: { type: "file", reason: "binary" },
  });

  expect(JSON.parse(label)).toEqual({
    parameter: "ticket",
    ticketId: "t-1",
    ticketKey: "PAGE-1",
    asset: BASE.asset,
    fileName: "notes.md",
    modelContent: "binary",
  });
});

it("labels an image without truncation or model content fields", () => {
  const label = ticketAssetLabel({
    ...BASE,
    content: { type: "image", mimeType: "image/png", base64: "AA==" },
  });

  expect(JSON.parse(label)).not.toHaveProperty("isTruncated");
  expect(JSON.parse(label)).not.toHaveProperty("modelContent");
});
