import { useState } from "react";

import { createRandomUuid } from "@/app/lib/random-uuid";

import { draftFromAutomation, emptyDraft } from "./automation-draft";
import { buildCreatePayload, buildUpdatePayload } from "./automation-payload";

import type { Automation, AutomationOptions } from "@/definition/Automation";
import type { AutomationPageIntent } from "@/definition/AutomationPage";
import type { AutomationDraft, DraftChange } from "./automation-draft";
import type {
  AutomationCreatePayload,
  AutomationUpdatePayload,
  Built,
  DraftProblem,
} from "./automation-payload";

/** Whether the panel shows an automation, edits it or creates a new one. */
export type EditorMode = "view" | "edit" | "create";

/**
 * Why the date and time are marked: switching on needs a new time, or the
 * entered time lies in the past.
 */
export type TimeAlert = "activate" | "future";

/** The editor of the detail panel. */
export interface AutomationEditor {
  readonly mode: EditorMode;
  /** The edited state; `null` while only viewing. */
  readonly draft: AutomationDraft | null;
  readonly problem: DraftProblem | null;
  readonly timeAlert: TimeAlert | null;
  readonly startCreate: () => void;
  /** Edits an automation; `isActivating` marks the time for switching on. */
  readonly startEdit: (automation: Automation, isActivating?: boolean) => void;
  readonly change: DraftChange;
  readonly save: (automation: Automation | undefined) => void;
  readonly close: () => void;
  readonly markTime: (alert: TimeAlert) => void;
}

interface EditorDependencies {
  readonly options: AutomationOptions;
  readonly now: Date;
  readonly submit: (intent: AutomationPageIntent, payload: object) => void;
}

interface EditorState {
  readonly mode: EditorMode;
  readonly draft: AutomationDraft | null;
  readonly original: AutomationDraft | null;
  readonly problem: DraftProblem | null;
  readonly timeAlert: TimeAlert | null;
}

const VIEWING: EditorState = {
  mode: "view",
  draft: null,
  original: null,
  problem: null,
  timeAlert: null,
};

function touchesTime(patch: Partial<AutomationDraft>): boolean {
  return "date" in patch || "time" in patch || "timeZone" in patch;
}

/**
 * Holds the draft of the panel and turns it into the input of `create` or
 * `update` with a fresh operation ID.
 */
export function useAutomationEditor({
  options,
  now,
  submit,
}: EditorDependencies): AutomationEditor {
  const [state, setState] = useState<EditorState>(VIEWING);

  function startCreate(): void {
    const draft = emptyDraft(options, now);
    setState({ ...VIEWING, mode: "create", draft, original: draft });
  }

  function startEdit(automation: Automation, isActivating = false): void {
    const original = draftFromAutomation(automation, options, now);
    setState({
      ...VIEWING,
      mode: "edit",
      original,
      draft: isActivating ? { ...original, isActive: true } : original,
      timeAlert: isActivating ? "activate" : null,
    });
  }

  function change(patch: Partial<AutomationDraft>): void {
    setState((current) =>
      current.draft
        ? {
            ...current,
            draft: { ...current.draft, ...patch },
            problem: null,
            timeAlert: touchesTime(patch) ? null : current.timeAlert,
          }
        : current,
    );
  }

  function buildPayload(
    automation: Automation | undefined,
  ): Built<AutomationCreatePayload | AutomationUpdatePayload> | null {
    const { draft, original } = state;
    if (!draft || !original) return null;
    const context = {
      options,
      now: new Date(),
      operationId: createRandomUuid(),
    };
    if (state.mode === "edit" && automation)
      return buildUpdatePayload(draft, original, automation, context);
    return buildCreatePayload(draft, context);
  }

  function save(automation: Automation | undefined): void {
    const built = buildPayload(automation);
    if (!built) return;
    if (built.problem) {
      const problem = built.problem;
      setState((current) => ({
        ...current,
        problem,
        timeAlert:
          problem === "time"
            ? (current.timeAlert ?? "future")
            : current.timeAlert,
      }));
      return;
    }
    submit(state.mode === "edit" ? "update" : "create", built.value);
  }

  return {
    mode: state.mode,
    draft: state.draft,
    problem: state.problem,
    timeAlert: state.timeAlert,
    startCreate,
    startEdit,
    change,
    save,
    close: () => setState(VIEWING),
    markTime: (alert) =>
      setState((current) => ({ ...current, timeAlert: alert })),
  };
}
