import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { createI18n } from "@/app/lib/i18n";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import type { DataRouter } from "react-router";
import type {
  PageAgent,
  PageAgentModel,
  PageAgentPage,
} from "@/definition/PageAgent";

export const i18n = createI18n("de");

/** A released model without reasoning levels. */
export const MODEL: PageAgentModel = {
  id: "model-1",
  name: "Sonnet",
  model: "claude-sonnet",
  reasoning: "none",
  reasoningEfforts: [],
  catalogDefaultReasoningEffort: null,
  reasoningEffort: null,
  provider: "openrouter",
};

/** The page of a person who sees no agent yet and may use {@link MODEL}. */
export const PAGE: PageAgentPage = {
  isAdministrator: false,
  agents: [],
  models: [MODEL],
  directory: { persons: [], groups: [], departments: [] },
  workspaces: [],
};

/**
 * A saved definition of {@link MODEL}.
 *
 * @param overrides - Fields that differ from the editable, ready default.
 */
export function pageAgent(overrides: Partial<PageAgent> = {}): PageAgent {
  return {
    id: "agent-1",
    ownerId: "owner",
    name: "Reviewer",
    modelProfileId: MODEL.id,
    reasoningEffort: null,
    configuration: emptyAgentConfiguration(),
    revision: 3,
    model: MODEL.model,
    canEdit: true,
    hasDeletedTargets: false,
    availability: { isUsable: true, reason: null, personalChoices: [] },
    provider: "openrouter",
    ...overrides,
  };
}

/** What the `/agents/agents` action answers; a promise holds the submission pending. */
export type AgentActionAnswer =
  | { readonly ok: true; readonly intent: string }
  | { readonly ok: false; readonly intent: string; readonly error: string };

/** The router behind a rendered element and the submissions its action received. */
export interface RenderedRoute {
  readonly router: DataRouter;
  readonly action: ReturnType<typeof vi.fn>;
  readonly submissions: FormData[];
}

/**
 * Renders an element at `/` of a memory router whose `/agents/agents` action
 * answers with `answer`, and offers a `/slow` route that never finishes loading.
 */
export function renderAgentRoute(
  element: React.ReactElement,
  answer: () => Promise<AgentActionAnswer> = async () => ({
    ok: true,
    intent: "save-agent",
  }),
): RenderedRoute {
  const submissions: FormData[] = [];
  const action = vi.fn(async ({ request }: { readonly request: Request }) => {
    submissions.push(await request.formData());
    return answer();
  });
  const router = createMemoryRouter(
    [
      { path: "/", element },
      { path: "/agents/agents", action },
      {
        path: "/slow",
        loader: () => new Promise<never>(() => {}),
        element: null,
      },
    ],
    { initialEntries: ["/"] },
  );
  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
  return { router, action, submissions };
}

/** Opens a select by keyboard and picks the option with the given name. */
export async function chooseOption(
  combobox: HTMLElement,
  option: string,
): Promise<void> {
  fireEvent.keyDown(combobox, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

/** A held answer that a test resolves once it has checked the pending state. */
export interface HeldAnswer {
  readonly answer: () => Promise<AgentActionAnswer>;
  readonly release: (result: AgentActionAnswer) => void;
}

/** Creates an action answer that stays pending until it is released. */
export function heldAnswer(): HeldAnswer {
  let release: (result: AgentActionAnswer) => void = () => {};
  const pending = new Promise<AgentActionAnswer>((resolve) => {
    release = resolve;
  });
  return { answer: () => pending, release: (result) => release(result) };
}
