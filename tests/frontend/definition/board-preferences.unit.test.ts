import { describe, expect, it } from "vitest";

import {
  DEFAULT_BOARD_PREFERENCES,
  hasBoardQuery,
  normalizeBoardPreferences,
  parseBoardQuery,
  parseStoredBoardPreferences,
  serializeBoardPreferences,
  withBoardQuery,
  withoutBoardQuery,
} from "@/definition/BoardPreferences";

describe("normalizeBoardPreferences", () => {
  it.each([null, undefined, "kanban", 7, []])(
    "returns the defaults for %j",
    (raw) => {
      expect(normalizeBoardPreferences(raw)).toEqual(DEFAULT_BOARD_PREFERENCES);
    },
  );

  it("keeps valid values and replaces invalid ones field by field", () => {
    expect(
      normalizeBoardPreferences({
        view: "list",
        scope: "mine",
        direction: "sideways",
        sort: 5,
        assignee: "group:team-1",
        project: "p-1",
        milestone: "not valid!",
        status: "no spaces allowed",
        search: "x".repeat(300),
      }),
    ).toMatchObject({
      view: "list",
      scope: "mine",
      direction: DEFAULT_BOARD_PREFERENCES.direction,
      sort: DEFAULT_BOARD_PREFERENCES.sort,
      assignee: "group:team-1",
      project: "p-1",
      milestone: "all",
      status: "all",
      search: "x".repeat(200),
    });
  });

  it("keeps the none marker, which is also a valid identifier", () => {
    expect(
      normalizeBoardPreferences({ assignee: "none", department: "none" }),
    ).toMatchObject({ assignee: "none", department: "none" });
  });

  it("rejects identifiers with unsafe characters or excessive length", () => {
    expect(
      normalizeBoardPreferences({
        project: "a/b",
        department: "x".repeat(65),
        assignee: "group:",
      }),
    ).toMatchObject({ project: "all", department: "all", assignee: "all" });
  });

  it("deduplicates label filters, drops invalid ones and caps the number", () => {
    const labels = Array.from({ length: 30 }, (_, index) => `l${index}`);

    expect(
      normalizeBoardPreferences({ labelIds: ["a", "a", "b c", 3, "b"] })
        .labelIds,
    ).toEqual(["a", "b"]);
    expect(
      normalizeBoardPreferences({ labelIds: labels }).labelIds,
    ).toHaveLength(20);
    expect(normalizeBoardPreferences({ labelIds: "a" }).labelIds).toEqual([]);
  });
});

describe("board query", () => {
  it("detects and removes board parameters while keeping others", () => {
    const params = new URLSearchParams("view=list&q=bug&ticket=42");

    expect(hasBoardQuery(params)).toBe(true);
    expect(hasBoardQuery(new URLSearchParams("ticket=42"))).toBe(false);
    expect(withoutBoardQuery(params).toString()).toBe("ticket=42");
    expect(params.toString()).toBe("view=list&q=bug&ticket=42");
  });

  it("falls back to the base for absent parameters only", () => {
    const base = normalizeBoardPreferences({ view: "list", scope: "mine" });

    expect(parseBoardQuery(new URLSearchParams("q=bug"), base)).toEqual({
      ...base,
      search: "bug",
    });
    expect(
      parseBoardQuery(new URLSearchParams("view=bogus&scope=all"), base),
    ).toMatchObject({ view: DEFAULT_BOARD_PREFERENCES.view, scope: "all" });
  });

  it("reads comma separated label identifiers", () => {
    expect(
      parseBoardQuery(
        new URLSearchParams("labels=a,,b"),
        DEFAULT_BOARD_PREFERENCES,
      ).labelIds,
    ).toEqual(["a", "b"]);
  });

  it("writes every preference so the address is independent of saved ones", () => {
    const preferences = normalizeBoardPreferences({
      labelIds: ["a", "b"],
      search: "two words",
    });
    const params = withBoardQuery(new URLSearchParams("ticket=1"), preferences);

    expect(params.get("ticket")).toBe("1");
    expect(params.get("labels")).toBe("a,b");
    expect(parseBoardQuery(params, DEFAULT_BOARD_PREFERENCES)).toEqual(
      preferences,
    );
  });
});

describe("stored preferences", () => {
  it("round-trips through the stored text", () => {
    const preferences = normalizeBoardPreferences({
      view: "list",
      labelIds: ["a"],
    });

    expect(
      parseStoredBoardPreferences(serializeBoardPreferences(preferences)),
    ).toEqual(preferences);
  });

  it("treats damaged text as nothing saved", () => {
    expect(parseStoredBoardPreferences("{broken")).toBe(
      DEFAULT_BOARD_PREFERENCES,
    );
    expect(parseStoredBoardPreferences("[1,2]")).toEqual(
      DEFAULT_BOARD_PREFERENCES,
    );
  });

  it("serializes only normalized values", () => {
    const text = serializeBoardPreferences({
      ...DEFAULT_BOARD_PREFERENCES,
      search: "y".repeat(500),
    });

    expect(JSON.parse(text)).toMatchObject({ search: "y".repeat(200) });
  });
});
