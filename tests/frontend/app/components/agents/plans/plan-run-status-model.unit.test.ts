import { expect, it } from "vitest";

import {
  planSequencePreview,
  statusTone,
} from "@/app/components/agents/plans/plan-run-status-model";

import { runStep, syntheticRun } from "../page72-run-fixture";
import { reviewCyclePlan } from "./plan-branching-fixture";
import { GROUP_SOURCES, i18n } from "./plan-group-fixture";

it("keeps a skipped step quiet next to the steps that ran", () => {
  const run = syntheticRun();
  const skipped = statusTone(runStep("fix", { status: "skipped" }), run);

  expect(skipped).toContain("text-plan-muted-foreground");
  expect(skipped).not.toContain("opacity");
  expect(skipped).not.toBe(statusTone(runStep("fix"), run));
  expect(statusTone(runStep("fix", { status: "failed" }), run)).toContain(
    "bg-destructive",
  );
});

it("names an unnamed decision by its type in the sequence preview", () => {
  const preview = planSequencePreview(
    reviewCyclePlan(),
    GROUP_SOURCES,
    i18n.t.bind(i18n),
  );
  const names = [...preview.steps, ...preview.gaps].map((entry) => entry.name);

  expect(names).toContain(i18n.t("plans.nodeType.decision"));
});
