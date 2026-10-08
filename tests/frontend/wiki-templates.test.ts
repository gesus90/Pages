import { describe, expect, it } from "vitest";

import {
  formatAreaChoice,
  parseAreaChoice,
  WIKI_BUILTIN_TEMPLATES,
} from "@/app/lib/wiki-templates";

describe("wiki templates and areas", () => {
  it("ships five templates", () => {
    expect(WIKI_BUILTIN_TEMPLATES).toEqual([
      "note",
      "decision",
      "guide",
      "idea",
      "incident",
    ]);
  });

  it("writes and reads every area", () => {
    expect(formatAreaChoice({ projectId: "p1", scope: "project" })).toBe(
      "project:p1",
    );
    expect(formatAreaChoice({ projectId: null, scope: "private" })).toBe(
      "private",
    );
    expect(formatAreaChoice({ projectId: null, scope: "instance" })).toBe(
      "instance",
    );
    expect(parseAreaChoice("project:p1")).toEqual({
      projectId: "p1",
      scope: "project",
    });
    expect(parseAreaChoice("private")).toEqual({
      projectId: null,
      scope: "private",
    });
    expect(parseAreaChoice("instance")).toEqual({
      projectId: null,
      scope: "instance",
    });
    expect(parseAreaChoice("anything")).toEqual({
      projectId: null,
      scope: "instance",
    });
  });
});
