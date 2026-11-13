import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { vi } from "vitest";

import { AgentSettingsDialog } from "@/app/components/agent-settings/agent-settings-dialog";
import { createI18n } from "@/app/lib/i18n";

import {
  flowRecipe,
  knowledgeRecipe,
  lessonView,
  lessonsOverview,
} from "./agent-dreaming-fixture";

import type {
  AgentLessonsOverview,
  AgentLessonsResponse,
} from "@/definition/AgentDreaming";

export const i18n = createI18n("en");

export const LESSON = lessonView("l1");
export const OFF_LESSON = lessonView("l2", {
  text: "Greet everybody by first name.",
  evidence: "Mei asked for it once.",
  strength: 1,
  isActive: false,
});
export const FLOW = flowRecipe("r1");
export const FAILED = flowRecipe("r2", {
  name: "close_all",
  summary: "Closes every open ticket.",
  isActive: false,
  disabledReason: "failed",
  failureStreak: 2,
  lastError: "set_ticket_status failed: forbidden",
  useCount: 3,
  lastUsedAt: null,
});
export const KNOWLEDGE = knowledgeRecipe("r3");
const OFF_KNOWLEDGE = knowledgeRecipe("r4", {
  name: "style_guide",
  summary: "House style for texts.",
  isActive: false,
  disabledReason: "manual",
  keywords: [],
});
export const FULL = lessonsOverview({
  lessons: [LESSON, OFF_LESSON],
  recipes: [FLOW, FAILED, KNOWLEDGE, OFF_KNOWLEDGE],
});

/** The response of the lessons endpoint with the overview. */
export function answer(
  overview: AgentLessonsOverview = FULL,
): AgentLessonsResponse {
  return { ok: true, overview };
}

/** Renders the agent settings popup on the tab Lessons & recipes. */
export function renderDialog(language = i18n): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={language}>
      <AgentSettingsDialog
        agentId="ed"
        initialTab="lessons"
        onClose={vi.fn()}
      />
    </I18nextProvider>,
  );
}

/** Waits until the list of the lessons is shown. */
export async function loaded(): Promise<HTMLElement> {
  return screen.findByRole("heading", { name: "Lessons" });
}

/** The list item with the text. */
export function row(text: string): HTMLElement {
  const item = screen.getByText(text).closest("li");
  if (item === null) throw new Error(`No row for ${text}`);
  return item;
}

/** The button with the accessible name. */
export function button(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

/** Whether the control is disabled. */
export function isOff(element: HTMLElement): boolean {
  return element.hasAttribute("disabled");
}

/** The input or text area with the label, the index-th one when the label repeats. */
export function field(
  label: string,
  index = 0,
): HTMLInputElement | HTMLTextAreaElement {
  const found = screen.getAllByLabelText(label)[index];
  if (
    !(found instanceof HTMLInputElement) &&
    !(found instanceof HTMLTextAreaElement)
  )
    throw new Error(`No field ${label}`);
  return found;
}

/** Changes the value of the field with the label. */
export function type(label: string, text: string, index = 0): void {
  fireEvent.change(field(label, index), { target: { value: text } });
}
