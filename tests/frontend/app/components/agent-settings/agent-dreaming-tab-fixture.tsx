import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { vi } from "vitest";

import { AgentSettingsDialog } from "@/app/components/agent-settings/agent-settings-dialog";
import { createI18n } from "@/app/lib/i18n";

import { dreamingOverview } from "./agent-dreaming-fixture";

import type { ComponentProps } from "react";
import type {
  AgentDreamLogEntry,
  AgentDreamSchedule,
  AgentDreamingOverview,
  AgentDreamingResponse,
} from "@/definition/AgentDreaming";

const i18n = createI18n("en");

export const CHEAP = {
  connectionId: "cheap-connection",
  model: "cheap-model",
  label: "Cheap Model",
};

/** The response of the Dreaming endpoint, optionally with the started or waiting run. */
export function answer(
  overview: AgentDreamingOverview = dreamingOverview(),
  run?: "started" | "waiting",
): AgentDreamingResponse {
  return run === undefined
    ? { ok: true, overview }
    : { ok: true, overview, run };
}

/** The default overview with the schedule partly overridden. */
export function scheduleOf(
  overrides: Partial<AgentDreamSchedule>,
): AgentDreamingOverview {
  const base = dreamingOverview();
  return dreamingOverview({ schedule: { ...base.schedule, ...overrides } });
}

/** Renders the agent settings popup on the Dreaming tab. */
export function renderDialog(
  props: Partial<ComponentProps<typeof AgentSettingsDialog>> = {},
  language = i18n,
): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={language}>
      <AgentSettingsDialog
        agentId="ed"
        initialTab="dreaming"
        onClose={vi.fn()}
        {...props}
      />
    </I18nextProvider>,
  );
}

/** Waits until the Dreaming switch is shown with the given name. */
export async function loaded(name = "Dreaming active"): Promise<HTMLElement> {
  return screen.findByRole("switch", { name });
}

/** Opens the combobox with the label and picks the option. */
export async function choose(label: string, option: string): Promise<void> {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

/** The input with the label; fails when the label belongs to no input. */
export function field(label: string): HTMLInputElement {
  const input = screen.getByLabelText(label);
  if (!(input instanceof HTMLInputElement))
    throw new Error(`${label} is no input`);
  return input;
}

/** Whether the control is disabled. */
export function isOff(element: HTMLElement): boolean {
  return element.hasAttribute("disabled");
}

/** The save button of the schedule. */
export function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: "Save" });
}

/** Lets the stubbed requests answer while the timers are fake; `findBy` cannot wait then. */
export async function settle(milliseconds = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

/** The card (section) with the heading of the title. */
export function card(title: string): HTMLElement {
  const section = screen
    .getByRole("heading", { name: title })
    .closest("section");
  if (section === null) throw new Error(`No card ${title}`);
  return section;
}

export const LOG: readonly AgentDreamLogEntry[] = [
  { kind: "recipeCreated", text: "ticket_status" },
  { kind: "memoryTaken", text: "Igor prefers short answers." },
  { kind: "memoryTaken", text: "PAGE-370 belongs to Ed." },
  { kind: "memoryDropped", text: "PAGE-360 is done." },
  { kind: "lessonLearned", text: "Read the ticket first." },
  { kind: "lessonStrengthened", text: "Ask only when the ticket is silent." },
  { kind: "lessonDropped", text: "Always greet first." },
  { kind: "recipeUpdated", text: "release_notes got a keyword" },
  { kind: "recipeDropped", text: "old_flow" },
];
