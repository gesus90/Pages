import { useState } from "react";
import { useSearchParams } from "react-router";

import type { Automation } from "@/definition/Automation";
import type { AutomationPageData } from "@/definition/AutomationPage";
import type { RunReference } from "./use-automation-run";

/** The tabs of the page. */
export const AUTOMATION_TABS = [
  "all",
  "recurring",
  "once",
  "event",
  "paused",
  "history",
] as const;

/** A tab of the page. */
export type AutomationTab = (typeof AUTOMATION_TABS)[number];

/** The tab, the selected automation and the opened run. */
export interface AutomationSelection {
  readonly tab: AutomationTab;
  readonly setTab: (tab: AutomationTab) => void;
  readonly visible: readonly Automation[];
  readonly counts: Readonly<Record<AutomationTab, number>>;
  /** The automation the panel shows: the selected one or the first of the tab. */
  readonly shown: Automation | undefined;
  /** Whether a row was chosen, which opens the panel as its own view on narrow screens. */
  readonly hasSelection: boolean;
  readonly select: (automationId: string | null) => void;
  /** Selects an automation and leaves a tab that does not show it. */
  readonly reveal: (
    automation: Pick<Automation, "id" | "trigger" | "isActive">,
  ) => void;
  readonly openRun: RunReference | null;
  readonly setOpenRun: (run: RunReference | null) => void;
}

/** Tells whether an automation belongs to a tab of the table. */
export function matchesTab(
  automation: Pick<Automation, "trigger" | "isActive">,
  tab: AutomationTab,
): boolean {
  const type = automation.trigger.type;
  switch (tab) {
    case "all":
    case "history":
      return true;
    case "recurring":
      return type === "interval" || type === "weekly";
    case "once":
      return type === "once";
    case "event":
      return type === "event";
    case "paused":
      return !automation.isActive;
  }
}

function readTab(value: string | null): AutomationTab {
  return AUTOMATION_TABS.find((tab) => tab === value) ?? "all";
}

function countTabs(
  automations: readonly Automation[],
  historyCount: number,
): Record<AutomationTab, number> {
  const count = (tab: AutomationTab): number =>
    automations.filter((automation) => matchesTab(automation, tab)).length;
  return {
    all: automations.length,
    recurring: count("recurring"),
    once: count("once"),
    event: count("event"),
    paused: count("paused"),
    history: historyCount,
  };
}

/**
 * Keeps the tab, the selected row and the opened run of the page.
 *
 * @remarks
 * `?tab=history&run=<runId>`, the link of a push notification, opens the
 * history with the dialog of that run.
 */
export function useAutomationSelection(
  pageData: AutomationPageData,
): AutomationSelection {
  const [searchParams] = useSearchParams();
  const [tab, setTabState] = useState<AutomationTab>(() =>
    readTab(searchParams.get("tab")),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<RunReference | null>(() => {
    const runId = searchParams.get("run");
    const run = pageData.history.find((entry) => entry.runId === runId);
    return run ? { automationId: run.automationId, runId: run.runId } : null;
  });
  const visible = pageData.automations.filter((automation) =>
    matchesTab(automation, tab),
  );
  const shown =
    visible.find((automation) => automation.id === selectedId) ?? visible[0];

  function setTab(next: AutomationTab): void {
    setTabState(next);
    setSelectedId(null);
  }

  function reveal(
    automation: Pick<Automation, "id" | "trigger" | "isActive">,
  ): void {
    if (tab === "history" || !matchesTab(automation, tab)) setTabState("all");
    setSelectedId(automation.id);
  }

  return {
    tab,
    setTab,
    visible,
    counts: countTabs(pageData.automations, pageData.history.length),
    shown,
    hasSelection: selectedId !== null,
    select: setSelectedId,
    reveal,
    openRun,
    setOpenRun,
  };
}
