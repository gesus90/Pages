import { expect, it } from "vitest";

import {
  formatAreaChoice,
  parseAreaChoice,
  WIKI_BUILTIN_TEMPLATES,
} from "@/app/lib/wiki-templates";

it("ships the built-in page templates", () => {
  expect(WIKI_BUILTIN_TEMPLATES).toEqual([
    "note",
    "decision",
    "guide",
    "idea",
    "incident",
  ]);
});

it("writes every area as a select value that reads back unchanged", () => {
  const areas = [
    { scope: "project", projectId: "alpha" },
    { scope: "instance", projectId: null },
    { scope: "private", projectId: null },
  ] as const;

  expect(areas.map(formatAreaChoice)).toEqual([
    "project:alpha",
    "instance",
    "private",
  ]);
  for (const area of areas)
    expect(parseAreaChoice(formatAreaChoice(area))).toEqual(area);
});

it("reads an unknown value as the whole instance", () => {
  expect(parseAreaChoice("elsewhere")).toEqual({
    projectId: null,
    scope: "instance",
  });
});
