import { describe, expect, it } from "vitest";

import {
  readSearchParams,
  writeSearchParams,
} from "@/app/lib/wiki-search-params";

describe("wiki search parameters", () => {
  it("reads every filter and trims the optional ones", () => {
    const params = new URLSearchParams(
      "q=release notes&location=project:p1&under=page-1&creator=u1&from=2026-01-01&to=2026-02-01&sort=newest&titleOnly=1",
    );

    expect(readSearchParams(params)).toEqual({
      text: "release notes",
      location: "project:p1",
      underPageId: "page-1",
      creatorId: "u1",
      editedFrom: "2026-01-01",
      editedTo: "2026-02-01",
      sort: "newest",
      titleOnly: true,
    });
  });

  it("reads missing and blank parameters as absent and keeps the search text as typed", () => {
    expect(
      readSearchParams(new URLSearchParams("creator=%20%20&q=%20a%20")),
    ).toEqual({
      text: " a ",
      location: null,
      underPageId: null,
      creatorId: null,
      editedFrom: null,
      editedTo: null,
      sort: null,
      titleOnly: false,
    });
    expect(readSearchParams(new URLSearchParams("")).text).toBe("");
    expect(readSearchParams(new URLSearchParams("titleOnly=0")).titleOnly).toBe(
      false,
    );
  });

  it("writes only the filters that are set", () => {
    expect(
      writeSearchParams({
        text: "release",
        location: null,
        underPageId: "page-1",
        creatorId: null,
        editedFrom: null,
        editedTo: "2026-02-01",
        sort: null,
        titleOnly: true,
      }),
    ).toBe("q=release&under=page-1&to=2026-02-01&titleOnly=1");
  });

  it("writes nothing for an empty search and skips a blank text", () => {
    const empty = {
      text: "   ",
      location: null,
      underPageId: null,
      creatorId: null,
      editedFrom: null,
      editedTo: null,
      sort: null,
      titleOnly: false,
    };

    expect(writeSearchParams(empty)).toBe("");
    expect(
      writeSearchParams({
        ...empty,
        text: " x ",
        location: "private",
        creatorId: "u",
        editedFrom: "2026-01-01",
        sort: "title",
      }),
    ).toBe("q=+x+&location=private&creator=u&from=2026-01-01&sort=title");
  });

  it("round-trips what it writes", () => {
    const input = {
      text: "a & b",
      location: "instance",
      underPageId: null,
      creatorId: "u1",
      editedFrom: null,
      editedTo: null,
      sort: "newest",
      titleOnly: true,
    };

    expect(
      readSearchParams(new URLSearchParams(writeSearchParams(input))),
    ).toEqual(input);
  });
});
