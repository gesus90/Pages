import { describe, expect, it } from "vitest";

import {
  EMPTY_OPTIMISTIC_STATE,
  applyOptimisticState,
  buildSaveFormData,
  createPendingLinks,
  createPendingMilestone,
  optimisticReducer,
  splitDated,
  withDraft,
} from "@/app/lib/phase-plan/plan-optimistic";

import type { OptimisticState } from "@/app/lib/phase-plan/plan-optimistic";
import type { PanelDraft } from "@/app/lib/phase-plan/plan-types";
import type { Milestone, MilestoneDependency } from "@/definition/Task";

function milestone(id: string, overrides: Partial<Milestone> = {}): Milestone {
  return {
    id,
    projectId: "project",
    name: `Milestone ${id}`,
    description: "",
    status: "open",
    startAt: null,
    dueAt: null,
    createdAt: "2026-01-01 00:00:00",
    updatedAt: "2026-01-01 00:00:00",
    completedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function link(
  id: string,
  sourceId: string,
  targetId: string,
): MilestoneDependency {
  return {
    id,
    projectId: "project",
    sourceId,
    targetId,
    linkType: "prerequisite",
    createdAt: "2026-01-01 00:00:00",
  };
}

const DRAFT: PanelDraft = {
  name: "  Beta release  ",
  start: "2026-06-01",
  end: "2026-06-30",
  description: "  Ship it.  ",
  color: "release",
  custom: "#123456",
  icon: "flag",
  status: "completed",
};

function reduce(
  state: OptimisticState,
  ...actions: Parameters<typeof optimisticReducer>[1][]
): OptimisticState {
  return actions.reduce(optimisticReducer, state);
}

describe("the optimistic reducer", () => {
  it("patches and unpatches one milestone without touching the others", () => {
    const patched = milestone("a", { name: "Renamed" });

    const withPatch = reduce(EMPTY_OPTIMISTIC_STATE, {
      type: "patch",
      milestoneId: "a",
      milestone: patched,
    });
    const without = reduce(withPatch, { type: "unpatch", milestoneId: "a" });

    expect(withPatch.patches.get("a")).toBe(patched);
    expect(without.patches.size).toBe(0);
    expect(EMPTY_OPTIMISTIC_STATE.patches.size).toBe(0);
  });

  it("adds a pending milestone and drops it by its temporary id", () => {
    const pending = milestone("temp-1");
    const added = reduce(EMPTY_OPTIMISTIC_STATE, {
      type: "addPending",
      milestone: pending,
    });
    const dropped = reduce(added, { type: "dropPending", tempId: "temp-1" });

    expect(added.pending).toEqual([pending]);
    expect(dropped.pending).toEqual([]);
  });

  it("hides a removed milestone and shows it again on restore", () => {
    const removed = reduce(EMPTY_OPTIMISTIC_STATE, {
      type: "remove",
      milestoneId: "a",
    });
    const restored = reduce(removed, { type: "restore", milestoneId: "a" });

    expect([...removed.removedIds]).toEqual(["a"]);
    expect(restored.removedIds.size).toBe(0);
  });

  it("collects new links, drops those of one pending milestone and hides removed ones", () => {
    const kept = link("pending-link-other-0-0", "other", "a");
    const dropped = link("pending-link-new-1-0", "new", "a");
    const added = reduce(EMPTY_OPTIMISTIC_STATE, {
      type: "addLinks",
      links: [kept, dropped],
    });
    const afterDrop = reduce(added, {
      type: "dropPendingLinks",
      milestoneId: "new",
    });
    const hidden = reduce(
      afterDrop,
      { type: "removeLinks", linkIds: ["x"] },
      { type: "removeLinks", linkIds: ["y"] },
    );

    expect(afterDrop.addedLinks).toEqual([kept]);
    expect([...hidden.removedLinkIds]).toEqual(["x", "y"]);
    expect(reduce(hidden, { type: "restoreLinks" }).removedLinkIds.size).toBe(
      0,
    );
  });

  it("forgets everything on reset", () => {
    const busy = reduce(
      EMPTY_OPTIMISTIC_STATE,
      { type: "remove", milestoneId: "a" },
      { type: "addPending", milestone: milestone("temp") },
    );

    expect(reduce(busy, { type: "reset" })).toBe(EMPTY_OPTIMISTIC_STATE);
  });
});

describe("applying the optimistic state", () => {
  const milestones = [milestone("a"), milestone("b"), milestone("c")];
  const links = [link("ab", "a", "b"), link("bc", "b", "c")];

  it("returns the server data unchanged for an empty state", () => {
    expect(
      applyOptimisticState(milestones, links, EMPTY_OPTIMISTIC_STATE),
    ).toEqual({ milestones, links });
  });

  it("removes, patches and appends milestones, then drops links to missing ones", () => {
    const patched = milestone("b", { name: "Renamed" });
    const pending = milestone("temp");
    const state = reduce(
      EMPTY_OPTIMISTIC_STATE,
      { type: "remove", milestoneId: "c" },
      { type: "patch", milestoneId: "b", milestone: patched },
      { type: "addPending", milestone: pending },
      {
        type: "addLinks",
        links: [link("new", "temp", "a"), link("ghost", "temp", "c")],
      },
    );

    const effective = applyOptimisticState(milestones, links, state);

    expect(effective.milestones.map((entry) => entry.name)).toEqual([
      "Milestone a",
      "Renamed",
      "Milestone temp",
    ]);
    expect(effective.links.map((entry) => entry.id)).toEqual(["ab", "new"]);
  });

  it("hides links the person is removing", () => {
    const state = reduce(EMPTY_OPTIMISTIC_STATE, {
      type: "removeLinks",
      linkIds: ["ab"],
    });

    expect(
      applyOptimisticState(milestones, links, state).links.map(
        (entry) => entry.id,
      ),
    ).toEqual(["bc"]);
  });
});

describe("splitting by date", () => {
  it("separates milestones with a start or due date from those without any", () => {
    const withStart = milestone("start", { startAt: "2026-06-10" });
    const withDue = milestone("due", { dueAt: "2026-07-01" });
    const without = milestone("none");

    const { dated, undated } = splitDated([withStart, without, withDue]);

    expect(dated.map((entry) => entry.milestone.id)).toEqual(["start", "due"]);
    expect(dated[0]?.time).toBe(new Date(2026, 5, 10).getTime());
    expect(dated[1]?.time).toBe(new Date(2026, 6, 1).getTime());
    expect(undated).toEqual([without]);
  });
});

describe("saving a milestone", () => {
  it("sends every field of a new milestone and no id or links", () => {
    const formData = buildSaveFormData(DRAFT, null, null);

    expect(Object.fromEntries(formData)).toEqual({
      intent: "save-milestone",
      name: "  Beta release  ",
      startAt: "2026-06-01",
      dueAt: "2026-06-30",
      description: "  Ship it.  ",
      colorKey: "release",
      customColor: "#123456",
      iconKey: "flag",
      status: "completed",
    });
  });

  it("names the milestone it edits and sends empty strings for absent color and icon", () => {
    const formData = buildSaveFormData(
      { ...DRAFT, custom: null, icon: null },
      "milestone-1",
      null,
    );

    expect(formData.get("milestoneId")).toBe("milestone-1");
    expect(formData.get("customColor")).toBe("");
    expect(formData.get("iconKey")).toBe("");
  });

  it("sends the link changes as JSON with only the type and the target", () => {
    const formData = buildSaveFormData(DRAFT, "milestone-1", {
      added: [{ targetId: "b", linkType: "prerequisite" }],
      removedIds: ["old-link"],
    });

    expect(JSON.parse(String(formData.get("addLinks")))).toEqual([
      { targetId: "b", linkType: "prerequisite" },
    ]);
    expect(JSON.parse(String(formData.get("removeLinks")))).toEqual([
      "old-link",
    ]);
  });

  it("applies the draft to a milestone, trimming text and emptying absent dates", () => {
    const applied = withDraft(milestone("a"), DRAFT);
    const cleared = withDraft(applied, { ...DRAFT, start: "", end: "" });

    expect(applied).toMatchObject({
      name: "Beta release",
      description: "Ship it.",
      startAt: "2026-06-01",
      dueAt: "2026-06-30",
      colorKey: "release",
      colorCustom: "#123456",
      iconKey: "flag",
      status: "completed",
    });
    expect(cleared).toMatchObject({ startAt: null, dueAt: null });
  });

  it("creates a pending milestone from the draft under its temporary id", () => {
    const pending = createPendingMilestone(DRAFT, "temp-7");

    expect(pending).toMatchObject({
      id: "temp-7",
      name: "Beta release",
      status: "completed",
      completedAt: null,
      archivedAt: null,
    });
    expect(pending.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
  });

  it("creates pending links that the reducer can later drop by milestone", () => {
    const links = createPendingLinks(
      milestone("new"),
      [
        { targetId: "a", linkType: "prerequisite" },
        { targetId: "b", linkType: "prerequisite" },
      ],
      4,
    );

    expect(links.map((entry) => entry.id)).toEqual([
      "pending-link-new-4-0",
      "pending-link-new-4-1",
    ]);
    expect(links.map((entry) => entry.sourceId)).toEqual(["new", "new"]);
    expect(links.map((entry) => entry.targetId)).toEqual(["a", "b"]);
    expect(links.every((entry) => entry.projectId === "project")).toBe(true);
  });
});
