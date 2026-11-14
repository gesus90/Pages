import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { emptyDraft } from "@/app/components/automations/automation-draft";
import { EventFields } from "@/app/components/automations/automation-event-fields";
import { buildTrigger } from "@/app/components/automations/automation-payload";
import { eventLabel } from "@/app/components/automations/automation-labels";
import { createI18n } from "@/app/lib/i18n";
import { AUTOMATION_EVENT_TYPES } from "@/definition/Automation";

import { now, options } from "./automation-fixture";

import type { AutomationOptions } from "@/definition/Automation";

const storageOptions: AutomationOptions = {
  ...options,
  eventTypes: AUTOMATION_EVENT_TYPES,
  eventExamples: {
    ...options.eventExamples,
    "storage.limit_exceeded": {
      totalBytes: 25_000_000_000,
      limitBytes: 20_000_000_000,
      largestDirectoryBytes: [18_000_000_000],
    },
  },
};
const draft = {
  ...emptyDraft(storageOptions, now),
  triggerKind: "event" as const,
  eventType: "storage.limit_exceeded" as const,
  projectId: "",
  planId: "stale-plan",
  stepId: "stale-step",
  statusId: "stale-status",
};

it("saves a storage trigger without requiring a project and drops former object filters", () => {
  expect(buildTrigger(draft, now)).toEqual({
    value: { type: "event", eventType: "storage.limit_exceeded" },
  });
});

it.each(["de", "en"])(
  "offers the storage event with a translated label and sizes without project or plan fields (%s)",
  (language) => {
    const context = {
      t: createI18n(language).t,
      now,
      timeZone: "UTC",
      language,
      names: {},
    };
    render(
      <EventFields
        draft={draft}
        change={vi.fn()}
        isReadOnly={false}
        options={storageOptions}
        context={context}
      />,
    );
    const label =
      language === "de"
        ? "Speichergrenze überschritten"
        : "Storage limit exceeded";
    expect(eventLabel(context, { eventType: "storage.limit_exceeded" })).toBe(
      label,
    );
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getByRole("combobox").textContent).toContain(label);
    expect(screen.getByText(/"totalBytes": 25000000000/u)).toBeTruthy();
    expect(
      screen.queryByText(context.t("automations.fields.project")),
    ).toBeNull();
    expect(screen.queryByText(context.t("automations.fields.plan"))).toBeNull();
  },
);
