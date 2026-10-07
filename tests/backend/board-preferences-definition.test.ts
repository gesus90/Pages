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
  it("starts with every ticket of tasks and subtasks in the kanban view", () => {
    expect(DEFAULT_BOARD_PREFERENCES).toMatchObject({
      group: "none",
      scope: "all",
      sort: "manual",
      type: "work",
      view: "kanban",
    });
  });

  it.each([undefined, null, "text", 4, []])(
    "turns %j into the defaults",
    (raw) => {
      expect(normalizeBoardPreferences(raw)).toEqual(DEFAULT_BOARD_PREFERENCES);
    },
  );

  it("keeps valid values", () => {
    const valid = {
      assignee: "group:team-1",
      department: "none",
      direction: "desc",
      group: "label",
      labelIds: ["label-1", "label_2"],
      milestone: "milestone-1",
      priority: "urgent",
      project: "project-1",
      scope: "mine",
      search: "login",
      sort: "dueDate",
      status: "status-1",
      type: "epic",
      view: "list",
    };

    expect(normalizeBoardPreferences(valid)).toEqual(valid);
  });

  it("replaces every invalid value with its default", () => {
    expect(
      normalizeBoardPreferences({
        assignee: "group:",
        department: "a b",
        direction: "up",
        group: "color",
        labelIds: "label-1",
        milestone: 4,
        priority: "critical",
        project: "x".repeat(65),
        scope: "everyone",
        search: 12,
        sort: "random",
        status: "",
        type: "bug",
        view: "table",
      }),
    ).toEqual(DEFAULT_BOARD_PREFERENCES);
  });

  it("accepts the unassigned assignee and an assignee user id", () => {
    expect(normalizeBoardPreferences({ assignee: "none" }).assignee).toBe(
      "none",
    );
    expect(normalizeBoardPreferences({ assignee: "user-1" }).assignee).toBe(
      "user-1",
    );
  });

  it("drops invalid, repeated and surplus labels and cuts a long search", () => {
    const labelIds = Array.from({ length: 30 }, (_, index) => `l${index}`);
    const normalized = normalizeBoardPreferences({
      labelIds: ["a", "a", "b c", 5, ...labelIds],
      search: "s".repeat(300),
    });

    expect(normalized.labelIds).toHaveLength(20);
    expect(normalized.labelIds.slice(0, 2)).toEqual(["a", "l0"]);
    expect(normalized.search).toHaveLength(200);
  });
});

describe("board address", () => {
  it("detects whether an address carries board parameters", () => {
    expect(hasBoardQuery(new URLSearchParams("item=PAGE-1"))).toBe(false);
    expect(hasBoardQuery(new URLSearchParams("item=PAGE-1&view=list"))).toBe(
      true,
    );
  });

  it("fills what the address lacks from the base", () => {
    const base = {
      ...DEFAULT_BOARD_PREFERENCES,
      project: "p1",
      scope: "mine",
    } as const;

    expect(parseBoardQuery(new URLSearchParams("view=list"), base)).toEqual({
      ...base,
      view: "list",
    });
  });

  it("falls back to the default, not the base, for an invalid value", () => {
    const base = { ...DEFAULT_BOARD_PREFERENCES, scope: "mine" } as const;

    expect(
      parseBoardQuery(new URLSearchParams("scope=nobody&view=nope"), base),
    ).toEqual(DEFAULT_BOARD_PREFERENCES);
  });

  it("reads and writes the label list as comma separated ids", () => {
    const preferences = {
      ...DEFAULT_BOARD_PREFERENCES,
      labelIds: ["l1", "l2"],
    };
    const written = withBoardQuery(
      new URLSearchParams("item=PAGE-1"),
      preferences,
    );

    expect(written.get("labels")).toBe("l1,l2");
    expect(written.get("item")).toBe("PAGE-1");
    expect(parseBoardQuery(written, DEFAULT_BOARD_PREFERENCES)).toEqual(
      preferences,
    );
    expect(
      parseBoardQuery(new URLSearchParams("labels="), preferences).labelIds,
    ).toEqual([]);
  });

  it("writes every preference, defaults included, and can remove them again", () => {
    const written = withBoardQuery(
      new URLSearchParams("item=PAGE-1"),
      DEFAULT_BOARD_PREFERENCES,
    );

    expect([...written.keys()].sort()).toEqual(
      [
        "assignee",
        "department",
        "dir",
        "group",
        "item",
        "labels",
        "milestone",
        "priority",
        "project",
        "q",
        "scope",
        "sort",
        "status",
        "type",
        "view",
      ].sort(),
    );
    expect(withoutBoardQuery(written).toString()).toBe("item=PAGE-1");
  });
});

describe("stored board preferences", () => {
  it("round-trips normalized preferences", () => {
    const preferences = {
      ...DEFAULT_BOARD_PREFERENCES,
      group: "project",
    } as const;

    expect(
      parseStoredBoardPreferences(serializeBoardPreferences(preferences)),
    ).toEqual(preferences);
  });

  it("normalizes while serializing and reading", () => {
    expect(
      parseStoredBoardPreferences('{"view":"list","scope":"nobody"}'),
    ).toEqual({ ...DEFAULT_BOARD_PREFERENCES, view: "list" });
  });

  it("treats damaged text as nothing saved", () => {
    expect(parseStoredBoardPreferences("{not json")).toEqual(
      DEFAULT_BOARD_PREFERENCES,
    );
  });
});
