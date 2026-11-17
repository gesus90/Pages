import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";

import { readPlanPollingResponse } from "@/app/lib/agent-plan-poll";
import { PlanWorkspaceLocks } from "@/app/components/agents/plans/plan-workspace-locks";
import { emptyAgentPlan } from "@/definition/AgentPlan";
import translations from "@/language/locales/de/translation.json";

import { planControl } from "./AgentPlanControl";

import type { AgentPlanWorkspaceLock } from "@/definition/AgentPlanWorkspaceLock";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";

const lock: AgentPlanWorkspaceLock = {
  runId: "older-run",
  planId: "plan",
  status: "failed",
  acquiredAt: "2026-01-01T00:00:00Z",
  ageMilliseconds: 3_600_000,
  reason: "resumable",
  isOverdue: false,
  canRelease: true,
};

function response(entries: unknown = [lock]): unknown {
  return {
    ok: true,
    intent: "poll-control",
    control: {
      ...planControl(
        {
          ...emptyAgentPlan(),
          id: "plan",
          ownerId: "owner",
          projectId: "project",
          revision: 1,
          canEdit: true,
          projectName: "Fixture",
          github: null,
        },
        null,
        {
          userId: "reader",
          hasReservation: false,
        },
      ),
      workspaceLocks: entries,
    },
  };
}

function parsedControl(input: unknown): AgentPlanControl {
  const result = readPlanPollingResponse(input);
  if (!result.ok || !result.control)
    throw new Error("Expected a control response");
  return result.control;
}

it("keeps an older run's reservation through polling and renders its Release button", async () => {
  const control = parsedControl(response());
  expect(control.workspaceLocks).toEqual([lock]);
  const i18n = createInstance();
  await i18n.init({
    lng: "de",
    resources: { de: { translation: translations } },
    interpolation: { escapeValue: false },
  });
  const html = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(PlanWorkspaceLocks, {
        entries: control.workspaceLocks ?? [],
      }),
    ),
  );
  expect(html).toContain("older-run");
  expect(html).toContain("Freigeben");
  expect(html).toContain("für seine Fortsetzung");
});

it("keeps a readable holder without offering unauthorized release", () => {
  const control = parsedControl(response([{ ...lock, canRelease: false }]));
  expect(control.workspaceLocks?.[0]?.canRelease).toBe(false);
});

it("removes stale entries when the server returns an empty reservation list", () => {
  expect(parsedControl(response([])).workspaceLocks).toEqual([]);
});

it("accepts older control responses without the optional reservation field", () => {
  const input = response();
  if (
    typeof input !== "object" ||
    !input ||
    !("control" in input) ||
    typeof input.control !== "object" ||
    !input.control
  )
    throw new Error("Expected a control fixture");
  const control = parsedControl({
    ...input,
    control: { ...input.control, workspaceLocks: undefined },
  });
  expect(control.workspaceLocks).toBeUndefined();
});

it.each([
  null,
  {},
  [{ ...lock, canRelease: "yes" }],
  [{ ...lock, reason: "unknown" }],
  [{ ...lock, ageMilliseconds: -1 }],
  [{ ...lock, acquiredAt: "invalid" }],
])(
  "rejects malformed reservation metadata instead of showing a false ready state",
  (entries) => {
    expect(() => readPlanPollingResponse(response(entries))).toThrow();
  },
);
