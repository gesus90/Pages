import { describe, expect, it, vi } from "vitest";

import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";
import { parseMarkdown } from "@/backend/service/agents/RelativeLinkScanner";

import {
  rewriteTicketDescription,
  ticketDescriptionAddress,
  ticketDescriptionReferences,
} from "./TicketDescriptionReferences";

import type * as RelativeLinkScanner from "@/backend/service/agents/RelativeLinkScanner";

vi.mock("@/backend/service/agents/RelativeLinkScanner", async (original) => {
  const actual = await original<typeof RelativeLinkScanner>();

  return { ...actual, parseMarkdown: vi.fn(actual.parseMarkdown) };
});

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}

const ID = "11111111-1111-1111-1111-111111111111";

describe("ticketDescriptionAddress", () => {
  it("parses agent and ticket routes with an optional suffix", () => {
    expect(ticketDescriptionAddress(`/agent-assets/${ID}?x=1`)).toEqual({
      id: ID,
      source: "agent",
    });
    expect(ticketDescriptionAddress(`/aufgaben/attachments/${ID}#a`)).toEqual({
      id: ID,
      source: "ticket",
    });
  });

  it("rejects foreign hosts", () => {
    expect(
      ticketDescriptionAddress(`https://x.test/agent-assets/${ID}`),
    ).toBeNull();
  });
});

describe("ticketDescriptionReferences", () => {
  it("finds inline images and links with exact offsets", () => {
    const markdown = `![a](/agent-assets/${ID}) and [b [c]](/x)`;
    const found = ticketDescriptionReferences(markdown);

    expect(found.map((reference) => reference.url)).toEqual([
      `/agent-assets/${ID}`,
      "/x",
    ]);
    expect(found[0].isImage).toBe(true);
    expect(found[1].isImage).toBe(false);
    for (const reference of found)
      expect(markdown.slice(reference.start, reference.end)).toBe(
        reference.url,
      );
  });

  it("finds angle-bracket destinations and escaped brackets", () => {
    const markdown = "[a\\]b](/y) <https://auto.test>";
    const found = ticketDescriptionReferences(markdown);

    expect(markdown.slice(found[0].start, found[0].end)).toBe("/y");
    expect(found[1].url).toBe("https://auto.test");
    expect(markdown.slice(found[1].start, found[1].end)).toBe(
      "https://auto.test",
    );
  });

  it("resolves reference-style destinations through the first definition", () => {
    const markdown =
      "![i][p] [l][q] [none][zz]\n\n[p]: /one\n[p]: /two\n[q]: /q";
    const found = ticketDescriptionReferences(markdown);

    expect(found.map((reference) => reference.url)).toContain("/one");
    expect(found.map((reference) => reference.url)).not.toContain("/two");
    expect(found.filter((reference) => reference.isImage)).toHaveLength(1);
  });

  it("reports an unlocatable destination with negative offsets", () => {
    const found = ticketDescriptionReferences("[a](<b c>)");

    expect(found[0].url).toBe("b c");
    expect(found[0].start).toBeGreaterThanOrEqual(0);
    const encoded = ticketDescriptionReferences("[a](/p%20q)");
    expect(encoded[0].start).toBeGreaterThanOrEqual(0);
    const decoded = ticketDescriptionReferences("[a](/caf&eacute;)");
    expect(decoded[0].start).toBe(-1);
    expect(decoded[0].end).toBe(-1);
  });

  it("finds a destination without any closing bracket", () => {
    const found = ticketDescriptionReferences("see https://bare.test now");

    expect(found.map((reference) => reference.url)).toEqual([
      "https://bare.test",
    ]);
  });

  it("falls back when a node carries no usable offsets", () => {
    vi.mocked(parseMarkdown).mockReturnValueOnce(
      doubleOf<ReturnType<typeof parseMarkdown>>({
        children: [
          { type: "linkReference", identifier: "missing" },
          { type: "link", url: "/a" },
          {
            type: "link",
            url: "/b",
            position: { start: { offset: 3 }, end: {} },
          },
        ],
        type: "root",
      }),
    );

    expect(ticketDescriptionReferences("abcdef")).toEqual([
      { end: -1, isImage: false, start: -1, url: "/a" },
      { end: -1, isImage: false, start: -1, url: "/b" },
    ]);
  });

  it("flags embedded HTML images and ignores other HTML", () => {
    const found = ticketDescriptionReferences("<img src=x>\n\n<div>hi</div>");

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ end: -1, isImage: true, start: -1 });
  });
});

describe("rewriteTicketDescription", () => {
  it("replaces destinations from the end and keeps the rest", () => {
    const markdown = `![a](/agent-assets/${ID}) text [b](/agent-assets/${ID})`;
    const found = ticketDescriptionReferences(markdown);
    const replacements = new Map(
      found.map((reference, index) => [reference, `/z${index}`]),
    );

    expect(rewriteTicketDescription(markdown, replacements)).toBe(
      "![a](/z0) text [b](/z1)",
    );
  });

  it("refuses a reference without offsets", () => {
    const found = ticketDescriptionReferences("<img src=x>");

    expect(() =>
      rewriteTicketDescription("<img src=x>", new Map([[found[0], "/n"]])),
    ).toThrow(WorkItemValidationError);
  });

  it("refuses when an agent upload link remains", () => {
    const markdown = `[a](/agent-assets/${ID})`;

    expect(() => rewriteTicketDescription(markdown, new Map())).toThrow(
      WorkItemValidationError,
    );
  });
});
