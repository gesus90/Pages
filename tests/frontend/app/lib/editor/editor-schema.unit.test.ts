import { expect, it } from "vitest";

import {
  ANCHORABLE_NODES,
  EDITOR_NODE,
  LIST_NODES,
  readFlagAttribute,
  readNumberAttribute,
  readTextAttribute,
} from "@/app/lib/editor/editor-schema";

it("reads a non-empty text attribute and nothing else", () => {
  const attributes = { title: "Plan", empty: "", count: 3 };

  expect(readTextAttribute(attributes, "title")).toBe("Plan");
  expect(readTextAttribute(attributes, "empty")).toBeNull();
  expect(readTextAttribute(attributes, "count")).toBeNull();
  expect(readTextAttribute(attributes, "missing")).toBeNull();
});

it("reads a whole number and falls back for anything else", () => {
  const attributes = { level: 2, ratio: 1.5, text: "3" };

  expect(readNumberAttribute(attributes, "level", 1)).toBe(2);
  expect(readNumberAttribute(attributes, "ratio", 1)).toBe(1);
  expect(readNumberAttribute(attributes, "text", 1)).toBe(1);
  expect(readNumberAttribute(attributes, "missing", 7)).toBe(7);
});

it("reads only a literal true as a set flag", () => {
  const attributes = { checked: true, open: "true", off: false };

  expect(readFlagAttribute(attributes, "checked")).toBe(true);
  expect(readFlagAttribute(attributes, "open")).toBe(false);
  expect(readFlagAttribute(attributes, "off")).toBe(false);
  expect(readFlagAttribute(attributes, "missing")).toBe(false);
});

it("lets block nodes carry anchors and lists be loose", () => {
  expect(ANCHORABLE_NODES).toContain(EDITOR_NODE.paragraph);
  expect(ANCHORABLE_NODES).not.toContain(EDITOR_NODE.listItem);
  expect(LIST_NODES).toEqual([
    EDITOR_NODE.bulletList,
    EDITOR_NODE.orderedList,
    EDITOR_NODE.taskList,
  ]);
});
