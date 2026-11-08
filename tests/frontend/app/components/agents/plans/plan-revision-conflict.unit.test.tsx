import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanRevisionConflict } from "@/app/components/agents/plans/plan-revision-conflict";

import {
  actionScene,
  i18n,
  planPage,
  renderWithEditor,
} from "./plan-panel-fixture";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";

function renderConflict(
  answer: AgentPlanActionResult,
): ReturnType<typeof actionScene> {
  const scene = actionScene(answer);
  renderWithEditor(planPage(), scene, (editor) => (
    <PlanRevisionConflict editor={editor} />
  ));
  return scene;
}

function save(): void {
  fireEvent.click(screen.getByRole("button", { name: "Submit draft" }));
}

function dialog(): Promise<HTMLElement> {
  return screen.findByRole("dialog", {
    name: i18n.t("plans.execution.conflictTitle"),
  });
}

it("compares the kept draft with the stored plan without naming any revision", async () => {
  renderConflict({
    ok: false,
    intent: "save-plan",
    error: "plan_conflict",
    currentRevision: 5,
  });
  expect(screen.queryByRole("dialog")).toBeNull();

  save();
  const shown = await dialog();

  expect(shown.textContent).toContain(i18n.t("plans.execution.draftChange"));
  expect(shown.textContent).toContain("Synthetic plan");
  expect(shown.textContent).toContain(i18n.t("plans.execution.savedPlan"));
  expect(shown.textContent).not.toMatch(/revision/iu);
  expect(shown.textContent).not.toContain("5");
});

it("loads the stored plan again at the current address", async () => {
  const scene = actionScene({
    ok: false,
    intent: "save-plan",
    error: "plan_conflict",
  });
  const { router } = renderWithEditor(planPage(), scene, (editor) => (
    <PlanRevisionConflict editor={editor} />
  ));
  save();
  await dialog();
  const navigate = vi.spyOn(router, "navigate");

  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.flow.storage.reload") }),
  );

  expect(navigate).toHaveBeenCalledWith(
    "/agents/plans?planId=plan",
    expect.anything(),
  );
});

it("closes with Cancel and opens again on the next refusal", async () => {
  const scene = renderConflict({
    ok: false,
    intent: "save-plan",
    error: "plan_conflict",
  });
  save();
  const shown = await dialog();
  expect(shown.textContent).toContain(i18n.t("plans.execution.savedPlan"));

  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("settings.agents.cancel") }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  scene.answer = { ...scene.answer };
  save();

  await dialog();
  expect(scene.submissions).toHaveLength(2);
});

it("closes with Escape", async () => {
  renderConflict({ ok: false, intent: "save-plan", error: "plan_conflict" });
  save();

  fireEvent.keyDown(await dialog(), { key: "Escape" });

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it.each<[string, AgentPlanActionResult]>([
  ["an accepted save", { ok: true, intent: "save-plan" }],
  [
    "another refusal",
    { ok: false, intent: "save-plan", error: "plan_invalid" },
  ],
])("stays closed after %s", async (name, answer) => {
  const scene = renderConflict(answer);

  save();

  await waitFor(() => expect(scene.submissions).toHaveLength(1));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByRole("dialog")).toBeNull();
});
