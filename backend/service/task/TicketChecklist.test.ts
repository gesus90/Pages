import { expect, it } from "vitest";

import {
  materializeTicketChecklist,
  readMarkdownTasks,
  setDescriptionCheckbox,
} from "./TicketChecklist";

import type { WorkItemChecklistItem } from "@/definition/Task";

function criterion(id: string, isDone: boolean): WorkItemChecklistItem {
  return {
    createdAt: "",
    id,
    isDone,
    sortOrder: 1,
    title: `Criterion ${id}`,
    updatedAt: "",
    workItemId: "w",
  };
}

it("reads nested task items with unique names for equal texts", () => {
  const items = readMarkdownTasks(
    "- [ ] one\n  - [x] child\n- [ ] one\n- plain\n- [X] `code` tail\n",
  );

  expect(items.map((item) => [item.text, item.checked, item.depth])).toEqual([
    ["one", false, 0],
    ["child", true, 1],
    ["one", false, 0],
    ["`code` tail", true, 0],
  ]);
  expect(new Set(items.map((item) => item.id)).size).toBe(4);
  expect(items[1]?.parentId).toBe(items[0]?.id);
  expect(items.map((item) => item.order)).toEqual([0, 1, 2, 3]);
});

it("ignores code blocks and checkbox lookalikes", () => {
  expect(readMarkdownTasks("```\n- [ ] no\n```\n\n- [text] no\n")).toEqual([]);
});

it("skips task items without a readable checkbox", () => {
  expect(readMarkdownTasks("- [x]\n\n  para\n")).toEqual([]);
  expect(readMarkdownTasks("- [ ]\n")).toEqual([]);
});

it("reads the text of an item whose paragraph follows the checkbox line", () => {
  expect(readMarkdownTasks("- [ ]\n  text\n").map((item) => item.text)).toEqual(
    ["text"],
  );
});

it("materializes description entries followed by criteria", () => {
  const result = materializeTicketChecklist("- [ ] a\n", [
    criterion("1", true),
  ]);

  expect(
    result.items.map((item) => [item.id.slice(0, 3), item.source, item.order]),
  ).toEqual([
    ["md-", "description", 0],
    ["ac-", "criteria", 1],
  ]);
  expect(result.items[1]?.checked).toBe(true);
  expect(result.markers.size).toBe(1);
  expect(result.criteria.get("ac-1")?.id).toBe("1");
});

it("keeps the requirements hash stable across checkbox changes", () => {
  const open = materializeTicketChecklist("- [ ] a\n", []);
  const done = materializeTicketChecklist("- [x] a\n", []);

  expect(open.requirementsHash).toBe(done.requirementsHash);
  expect(open.contentHash).not.toBe(done.contentHash);
});

it("sets and clears one checkbox character", () => {
  expect(setDescriptionCheckbox("- [ ] a", 3, true)).toBe("- [x] a");
  expect(setDescriptionCheckbox("- [x] a", 3, false)).toBe("- [ ] a");
});
