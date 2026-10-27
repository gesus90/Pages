import { describe, expect, it } from "vitest";

import {
  readReferences,
  toEditorReference,
} from "@/app/lib/wiki-editor-references";

import type { WikiReference } from "@/definition/Wiki";

const PAGE: WikiReference = {
  kind: "page",
  id: "p1",
  title: "Roadmap",
  icon: "🗺",
};
const TICKET: WikiReference = {
  kind: "ticket",
  key: "PAGE-7",
  title: "Fix login",
};
const PERSON: WikiReference = {
  kind: "person",
  id: "u1",
  username: "ada",
  displayName: "Ada Lovelace",
};

const hintOf = (kind: WikiReference["kind"]): string => `hint:${kind}`;

describe("reading references", () => {
  it("keeps the entries of the three known kinds", () => {
    expect(readReferences({ references: [PAGE, TICKET, PERSON] })).toEqual([
      PAGE,
      TICKET,
      PERSON,
    ]);
  });

  it("drops entries of an unknown kind and entries that are no objects", () => {
    expect(
      readReferences({
        references: [{ kind: "file" }, null, "page", 7, {}, PAGE],
      }),
    ).toEqual([PAGE]);
  });

  it("answers an empty list for anything but a list of references", () => {
    expect(readReferences(null)).toEqual([]);
    expect(readReferences("text")).toEqual([]);
    expect(readReferences({})).toEqual([]);
    expect(readReferences({ references: "page" })).toEqual([]);
  });
});

describe("references as editor suggestions", () => {
  it("links a page by its id and shows its icon in the label", () => {
    expect(toEditorReference(PAGE, hintOf)).toEqual({
      hint: "hint:page",
      key: "page:p1",
      label: "🗺 Roadmap",
      insertion: { kind: "link", href: "/wiki/p1", text: "Roadmap" },
    });
  });

  it("labels a page without an icon by its title only", () => {
    expect(toEditorReference({ ...PAGE, icon: null }, hintOf).label).toBe(
      "Roadmap",
    );
  });

  it("links a ticket by its key", () => {
    expect(toEditorReference(TICKET, hintOf)).toEqual({
      hint: "hint:ticket",
      key: "ticket:PAGE-7",
      label: "PAGE-7 Fix login",
      insertion: { kind: "link", href: "/aufgaben/PAGE-7", text: "PAGE-7" },
    });
  });

  it("inserts a person as a mention with a trailing space", () => {
    expect(toEditorReference(PERSON, hintOf)).toEqual({
      hint: "hint:person",
      key: "person:u1",
      label: "Ada Lovelace",
      insertion: { kind: "text", text: "@ada " },
    });
  });
});
