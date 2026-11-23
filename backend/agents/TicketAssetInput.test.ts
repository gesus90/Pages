import { describe, expect, it, vi } from "vitest";

import {
  readTicketAssetInput,
  ticketAssetLabel,
} from "@/backend/agents/TicketAssetInput";
import { AgentError } from "@/backend/error/AgentErrors";

import type {
  AgentTicketAssetContent,
  AgentTicketInput,
} from "@/definition/AgentTicketParameter";

const ORIGINAL = { mimeType: "text/plain", size: 5, digest: "d" };
const TICKET = {
  id: "t1",
  key: "K-1",
  title: "T",
  description: "",
  assets: [],
  markdown: "",
  version: "1",
};
const TICKET_INPUTS: readonly AgentTicketInput[] = [
  { parameter: "ticket", ticket: TICKET },
];

function asset(
  overrides: Partial<AgentTicketAssetContent>,
): AgentTicketAssetContent {
  return {
    parameter: "ticket",
    ticketId: "t1",
    ticketKey: "K-1",
    asset: { source: "ticket", id: "a1", link: "l" },
    fileName: "a.txt",
    owner: { type: "ticket", id: "t1" },
    original: ORIGINAL,
    path: "a.txt",
    content: { type: "text", text: "hello", isTruncated: true },
    ...overrides,
  };
}

describe("readTicketAssetInput", () => {
  it("returns nothing without ticket inputs", async () => {
    expect(await readTicketAssetInput({})).toEqual([]);
    expect(await readTicketAssetInput({ ticketInputs: [] })).toEqual([]);
  });

  it("refuses ticket inputs without a reader", async () => {
    await expect(
      readTicketAssetInput({
        ticketInputs: TICKET_INPUTS,
      }),
    ).rejects.toBeInstanceOf(AgentError);
  });

  it("returns what the reader delivers", async () => {
    const assets = [asset({})];
    const readTicketAssets = vi.fn().mockResolvedValue(assets);

    const result = await readTicketAssetInput({
      ticketInputs: TICKET_INPUTS,
      readTicketAssets,
    });

    expect(result).toBe(assets);
  });
});

describe("ticketAssetLabel", () => {
  it("labels an original text asset with its truncation", () => {
    const label = JSON.parse(ticketAssetLabel(asset({}))) as Record<
      string,
      unknown
    >;

    expect(label.ticketKey).toBe("K-1");
    expect(label.isTruncated).toBe(true);
    expect(label.representation).toBeDefined();
    expect(label.modelContent).toBeUndefined();
  });

  it("names the reason of a file and omits the representation of a copy", () => {
    const label = JSON.parse(
      ticketAssetLabel(
        asset({
          original: undefined,
          content: { type: "file", reason: "too large" },
        }),
      ),
    ) as Record<string, unknown>;

    expect(label.modelContent).toBe("too large");
    expect(label.representation).toBeUndefined();
    expect(label.isTruncated).toBeUndefined();
  });
});
