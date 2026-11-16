import { expect, it } from "vitest";

import {
  planNotationNodeEntries,
  planNotationValueText,
} from "@/backend/service/mcp/plan/PlanNotationNodeWriter";

import { partial } from "../../../app/lib/service-wiring-fakes";
import { decision } from "../../../definition/group-edit-fixtures";
import {
  groupOf,
  loopOf,
  planOf,
  script,
} from "../../../definition/plan-fixtures";

import type { PlanNotationWriterContext } from "@/backend/service/mcp/plan/PlanNotationAgentWriter";

const CONTEXT = partial<PlanNotationWriterContext>({
  plan: planOf([]),
  names: {
    ticketKey: (id: string) => (id === "known" ? "PAGE-1" : id),
    workspaceName: (id: string) => (id === "known" ? "Workspace" : id),
    wikiTitle: (id: string) => (id === "known" ? "Wiki" : id),
    interpreterName: () => null,
  },
});

it("writes recognizable reference names and keeps unknown identifiers explicit", () => {
  expect(planNotationValueText({ type: "text", text: "hello" }, CONTEXT)).toBe(
    '"hello"',
  );
  expect(planNotationValueText({ type: "number", number: 2 }, CONTEXT)).toBe(
    "2",
  );
  expect(
    planNotationValueText({ type: "ticket", ticketId: "known" }, CONTEXT),
  ).toBe('"PAGE-1"');
  expect(
    planNotationValueText({ type: "ticket", ticketId: "unknown" }, CONTEXT),
  ).toBeNull();
  expect(
    planNotationValueText({ type: "workspace", workspaceId: "known" }, CONTEXT),
  ).toBe("Workspace");
  expect(
    planNotationValueText({ type: "wiki", pageId: "known" }, CONTEXT),
  ).toBe("Wiki");
  expect(
    planNotationValueText({ type: "asset", assetId: "asset" }, CONTEXT),
  ).toBeNull();
});

it("writes script, stack, frame and decision settings without their defaults", () => {
  const node = {
    ...script("s"),
    name: "Build",
    timeoutSeconds: 99,
    inputs: [{ name: "source", type: "text" as const, isRequired: true }],
    outputs: [
      { name: "result", type: "text" as const, policy: "report" as const },
    ],
  };
  expect(planNotationNodeEntries(node, CONTEXT)).toEqual(
    expect.arrayContaining([
      { key: "name", value: '"Build"' },
      { key: "interpreterProfileId", value: '"shell"' },
      { key: "inputs", value: '"source!"' },
      { key: "timeout", value: "99" },
    ]),
  );
  const stack = {
    id: "stack",
    type: "stack" as const,
    name: "stack",
    x: 0,
    y: 0,
    entries: [{ id: "one", type: "task" as const, taskId: "known" }],
  };
  expect(planNotationNodeEntries(stack, CONTEXT)).toContainEqual({
    key: "entries",
    value: '"PAGE-1"',
  });
  expect(planNotationNodeEntries(groupOf("group", []), CONTEXT)).toEqual([
    { key: "type", value: "group" },
  ]);
  expect(planNotationNodeEntries(loopOf("loop", []), CONTEXT)[0]).toEqual({
    key: "type",
    value: "loop",
  });
  expect(
    planNotationNodeEntries(
      { ...decision("d"), name: "Choice", question: "Proceed?" },
      CONTEXT,
    ),
  ).toContainEqual({ key: "question", value: '"Proceed?"' });
});
