import { beforeEach, expect, it, vi } from "vitest";

const parse = vi.hoisted(() => vi.fn());

vi.mock("unified", () => {
  const processor = { parse, use: (): unknown => processor };
  return { unified: (): unknown => processor };
});

import { readMarkdownTasks } from "./TicketChecklist";

interface Span {
  readonly position?: {
    readonly start: { readonly offset?: number };
    readonly end: { readonly offset?: number };
  };
}

function span(start: number | undefined, end: number | undefined): Span {
  return { position: { end: { offset: end }, start: { offset: start } } };
}

function treeOf(item: object): object {
  return { children: [item], type: "root" };
}

beforeEach(() => {
  parse.mockReset();
});

it("skips an item without positions", () => {
  parse.mockReturnValue(
    treeOf({ checked: false, children: [{}], type: "listItem" }),
  );

  expect(readMarkdownTasks("- [ ] a")).toEqual([]);
});

it("skips an item without a start offset", () => {
  parse.mockReturnValue(
    treeOf({
      checked: false,
      children: [span(0, 5)],
      position: { end: {}, start: {} },
      type: "listItem",
    }),
  );

  expect(readMarkdownTasks("- [ ] a")).toEqual([]);
});

it("skips an item whose span holds no checkbox", () => {
  parse.mockReturnValue(
    treeOf({
      checked: false,
      children: [span(0, 5)],
      position: span(0, 5).position,
      type: "listItem",
    }),
  );

  expect(readMarkdownTasks("- abc")).toEqual([]);
});

it("reads an empty text when the paragraph end disappears", () => {
  let reads = 0;
  const paragraph = {
    get position(): Span["position"] {
      reads += 1;
      return reads === 1 ? span(2, 7).position : span(2, undefined).position;
    },
  };
  parse.mockReturnValue(
    treeOf({
      checked: true,
      children: [paragraph],
      position: span(0, 7).position,
      type: "listItem",
    }),
  );

  expect(readMarkdownTasks("- [x] a").map((item) => item.text)).toEqual([""]);
});

it("reads an item with a regular paragraph", () => {
  parse.mockReturnValue(
    treeOf({
      checked: true,
      children: [span(2, 7)],
      position: span(0, 7).position,
      type: "listItem",
    }),
  );

  expect(readMarkdownTasks("- [x] a").map((item) => item.text)).toEqual(["a"]);
});

it("treats an item without children as having no checkbox", () => {
  parse.mockReturnValue(
    treeOf({
      checked: true,
      children: [],
      position: span(0, 5).position,
      type: "listItem",
    }),
  );

  expect(readMarkdownTasks("- [x]")).toEqual([]);
});
