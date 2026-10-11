import { describe, expect, it, vi } from "vitest";

import * as milestoneValidation from "@/backend/service/MilestoneValidation";
import * as ticketValidation from "@/backend/service/task/WorkItemValidation";
import { readStructuredManifest } from "@/backend/service/agents/StructuredImportManifestReader";
import { planStructuredImport } from "@/backend/service/agents/StructuredImportPlanner";

import { structuredManifest } from "../helpers/structured-import";

function graph(sources: readonly unknown[], links: readonly unknown[] = []) {
  return planStructuredImport(
    readStructuredManifest({ version: "1", sources, links }),
  );
}

const project = { kind: "project", key: "p", projectId: "p1" };
const milestone = { kind: "milestone", key: "m", name: "M", project: "p" };
const ticket = {
  kind: "ticket",
  key: "t",
  type: "task",
  title: "T",
  project: "p",
};

describe("structured source graph", () => {
  it("orders milestones, parents, children and dependencies with stable sibling order", () => {
    const planned = planStructuredImport(structuredManifest());
    expect(planned.errors).toEqual([]);
    expect(planned.steps.map((step) => step.key)).toEqual([
      "milestone:release",
      "milestone:next",
      "ticket:parent",
      "ticket:child",
      "dependency:release>next:blocks",
    ]);
    expect(planned.edges).toEqual([
      { type: "parent", from: "ticket:child", to: "ticket:parent" },
      { type: "milestone", from: "ticket:parent", to: "milestone:release" },
      {
        type: "dependency",
        from: "milestone:release",
        to: "milestone:next",
        linkType: "blocks",
      },
    ]);
  });

  it("reports duplicate keys separately for each kind and rejects invalid keys", () => {
    expect(
      graph([
        project,
        project,
        milestone,
        milestone,
        ticket,
        ticket,
        { ...ticket, key: "invalid:key" },
      ]).errors,
    ).toEqual([
      { code: "INVALID_REQUEST", reason: "duplicate_key", keys: ["project:p"] },
      {
        code: "INVALID_REQUEST",
        reason: "duplicate_key",
        keys: ["milestone:m"],
      },
      { code: "INVALID_REQUEST", reason: "duplicate_key", keys: ["ticket:t"] },
      {
        code: "INVALID_REQUEST",
        reason: "invalid_key",
        keys: ["ticket:invalid:key"],
      },
    ]);
  });

  it("collects missing projects, required parents and invalid fields without stopping at the first", () => {
    const planned = graph([
      { ...ticket, project: "", title: " " },
      { ...ticket, key: "sub", type: "subtask", project: "unknown" },
      { ...milestone, project: "unknown", name: " " },
      { ...milestone, key: "missing", project: "" },
    ]);
    expect(planned.errors.map((found) => [found.reason, found.keys])).toEqual([
      ["project_required", ["ticket:t"]],
      ["invalid_field", ["ticket:t"]],
      ["unknown_project", ["ticket:sub"]],
      ["unknown_project", ["milestone:m"]],
      ["invalid_field", ["milestone:m"]],
      ["project_required", ["milestone:missing"]],
      ["parent_required", ["ticket:sub"]],
    ]);
  });

  it.each([
    [{ type: "parent", from: "missing", to: "t" }, "missing_reference"],
    [{ type: "milestone", from: "t", to: "missing" }, "missing_reference"],
    [{ type: "parent", from: "t", to: "t" }, "self_reference"],
    [
      { type: "dependency", from: "m", to: "m", linkType: "blocks" },
      "self_reference",
    ],
    [{ type: "parent", from: "t", to: "other" }, "project_mismatch"],
    [{ type: "parent", from: "t", to: "same" }, "parent_type"],
  ])("checks link ends and hierarchy: %j", (link, reason) => {
    const planned = graph(
      [
        project,
        { ...project, key: "q" },
        milestone,
        ticket,
        { ...ticket, key: "other", project: "q" },
        { ...ticket, key: "same" },
      ],
      [link],
    );
    expect(planned.errors).toContainEqual(expect.objectContaining({ reason }));
  });

  it("does not add cross-project errors when either project is already missing", () => {
    for (const missing of ["from", "to"]) {
      const planned = graph(
        [
          project,
          { ...project, key: "q" },
          { ...ticket, project: missing === "from" ? "" : "p" },
          { ...ticket, key: "other", project: missing === "to" ? "" : "p" },
        ],
        [{ type: "parent", from: "t", to: "other" }],
      );
      expect(planned.errors.map((found) => found.reason)).toEqual([
        "project_required",
      ]);
      expect(planned.edges).toEqual([]);
    }
  });

  it("rejects repeated parent, milestone and unordered dependency pairs", () => {
    const links = [
      { type: "parent", from: "t", to: "epic" },
      { type: "milestone", from: "t", to: "m" },
      { type: "dependency", from: "m", to: "n", linkType: "relates_to" },
    ];
    const planned = graph(
      [
        project,
        ticket,
        { ...ticket, key: "epic", type: "epic" },
        milestone,
        { ...milestone, key: "n" },
      ],
      [
        ...links,
        ...links,
        { type: "dependency", from: "n", to: "m", linkType: "blocks" },
      ],
    );
    expect(planned.errors.map((found) => found.reason)).toEqual(
      Array(4).fill("duplicate_link"),
    );
    expect(planned.edges).toHaveLength(3);
  });

  it("reports directed cycles once and traverses converging dependency paths", () => {
    const sources = [
      project,
      ...["a", "b", "c", "d"].map((key) => ({ ...milestone, key })),
      ...["a", "b", "c"].map((key) => ({ ...ticket, key })),
    ];
    const links = [
      ...[
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
      ].map(([from, to]) => ({ type: "parent", from, to })),
      ...[
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
        ["a", "d"],
        ["b", "d"],
      ].map(([from, to]) => ({
        type: "dependency",
        from,
        to,
        linkType: "blocks",
      })),
    ];
    expect(
      graph(sources, links).errors.filter((found) => found.reason === "cycle"),
    ).toEqual([
      {
        code: "INVALID_REQUEST",
        reason: "cycle",
        keys: ["ticket:a", "ticket:b", "ticket:c"],
      },
      {
        code: "INVALID_REQUEST",
        reason: "cycle",
        keys: ["milestone:a", "milestone:b", "milestone:c"],
      },
    ]);
  });

  it.each([
    null,
    { project: "", parentId: null },
    { project: "unknown", parentId: null },
  ])("requires a resolvable wiki target: %j", (wiki) => {
    const planned = planStructuredImport({ ...structuredManifest(), wiki });
    expect(planned.errors.map((found) => found.reason)).toEqual([
      wiki === null
        ? "wiki_target_required"
        : wiki.project === ""
          ? "project_required"
          : "unknown_project",
    ]);
  });

  it.each(["ticket", "milestone"])(
    "propagates unexpected %s validation failures",
    (kind) => {
      const failure = new Error("validation unavailable");
      if (kind === "ticket")
        vi.spyOn(ticketValidation, "validateWorkItemText").mockImplementation(
          () => {
            throw failure;
          },
        );
      else
        vi.spyOn(
          milestoneValidation,
          "validateMilestoneInput",
        ).mockImplementation(() => {
          throw failure;
        });
      expect(() =>
        graph([project, kind === "ticket" ? ticket : milestone]),
      ).toThrow(failure);
    },
  );
});
