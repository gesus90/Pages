import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";

import { usePlanDraft } from "@/app/components/agents/plans/use-plan-draft";
import { emptyAgentPlan } from "@/definition/AgentPlan";

import { planPage, planView } from "./plan-panel-fixture";

import type { RenderHookResult } from "@testing-library/react";
import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type { AgentPlanPage } from "@/definition/AgentPlan";

interface DraftProps {
  readonly result: AgentPlanActionResult | undefined;
  readonly isPending: boolean;
}

function mount(
  page: AgentPlanPage = planPage(),
): RenderHookResult<ReturnType<typeof usePlanDraft>, DraftProps> {
  return renderHook<ReturnType<typeof usePlanDraft>, DraftProps>(
    (props) => usePlanDraft(page, props.result, props.isPending),
    { initialProps: { result: undefined, isPending: false } },
  );
}

it("starts an unsaved plan from the empty plan", () => {
  const { result } = mount(planPage({ selected: null }));
  expect(result.current.draft).toEqual(emptyAgentPlan());
  expect(result.current.isDirty).toBe(false);
});

it("copies the saved plan with its execution target and tracks edits", () => {
  const target = { kind: "local" as const };
  const { result } = mount(
    planPage({ selected: planView({ executionTarget: target }) }),
  );
  expect(result.current.draft).toMatchObject({
    name: "Synthetic plan",
    workspaceId: "workspace",
    projectId: "project",
    executionTarget: target,
    revision: 3,
  });
  act(() =>
    result.current.setDraft((draft) => ({ ...draft, name: "Renamed" })),
  );
  expect(result.current.isDirty).toBe(true);
});

it("adopts the stored revision of an acknowledged save", () => {
  const { result, rerender } = mount();
  expect(result.current.draft).not.toHaveProperty("executionTarget");
  act(() =>
    result.current.setDraft((draft) => ({ ...draft, name: "Renamed" })),
  );
  result.current.submitted.current = result.current.draft;
  rerender({ result: undefined, isPending: true });
  expect(result.current.isDirty).toBe(true);
  rerender({
    result: { ok: true, intent: "save-plan", revision: 4 },
    isPending: false,
  });
  expect(result.current.draft).toMatchObject({ name: "Renamed", revision: 4 });
  expect(result.current.isDirty).toBe(false);
});

it("keeps edits made while a start was saving on top of the stored revision", () => {
  const { result, rerender } = mount();
  result.current.submitted.current = result.current.draft;
  act(() =>
    result.current.setDraft((draft) => ({ ...draft, name: "Later edit" })),
  );
  rerender({
    result: { ok: true, intent: "play-plan", revision: 5 },
    isPending: false,
  });
  expect(result.current.draft).toMatchObject({
    name: "Later edit",
    revision: 5,
  });
  expect(result.current.isDirty).toBe(true);
});

it("ignores answers that store no revision of the submitted draft", () => {
  const { result, rerender } = mount();
  act(() =>
    result.current.setDraft((draft) => ({ ...draft, name: "Renamed" })),
  );
  const answers: readonly AgentPlanActionResult[] = [
    { ok: false, intent: "save-plan", error: "conflict" },
    { ok: true, intent: "save-plan" },
    { ok: true, intent: "stop-plan", revision: 9 },
  ];
  for (const answer of answers) {
    rerender({ result: answer, isPending: false });
    expect(result.current.draft.revision).toBe(3);
  }
  // Without a submitted draft a stored revision changes nothing either.
  rerender({
    result: { ok: true, intent: "save-plan", revision: 6 },
    isPending: false,
  });
  expect(result.current.draft.revision).toBe(3);
  expect(result.current.isDirty).toBe(true);
});
