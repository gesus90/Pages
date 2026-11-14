import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { ChatPageReplySettings } from "@/app/components/chat-page/chat-page-reply-settings";
import { createI18n } from "@/app/lib/i18n";
import { CONVERSATION_DEFAULT_DECISION_RULES } from "@/definition/ConversationDecision";

import { group } from "./chat-page-fixture";

import type {
  ConversationDecisionEntry,
  ConversationReplySettingsView,
} from "@/definition/ConversationDecision";

interface FakeFetcher {
  data: unknown;
  state: "idle" | "submitting";
  submit: Mock<(...args: unknown[]) => void>;
}

const fetchers = vi.hoisted(() => ({
  list: [] as FakeFetcher[],
  calls: 0,
}));
vi.mock("react-router", () => ({
  // The popup asks for the fetchers in a fixed order: settings, decisions, save.
  useFetcher: () => fetchers.list[fetchers.calls++ % 3],
}));

const i18n = createI18n("en");

const SETTINGS: ConversationReplySettingsView = {
  conversationId: "g",
  mode: "decision",
  rules: CONVERSATION_DEFAULT_DECISION_RULES,
  defaults: CONVERSATION_DEFAULT_DECISION_RULES,
  isDefault: true,
  canManage: true,
  decisionModel: { status: "ready", name: "Perplexity Decider V1.3" },
  hint: null,
};

const DECISIONS: readonly ConversationDecisionEntry[] = [
  {
    messageId: "m1",
    outcome: "responders",
    fallback: "none",
    responders: [{ id: "ed", name: "Ed" }],
    answerProbability: 0.82,
    choices: [
      { agentId: "ed", name: "Ed", probability: 0.78 },
      { agentId: "mei", name: "Mei", probability: 0.15 },
      { agentId: null, name: "", probability: 0.07 },
    ],
    model: "perplexity/pplx-decider-v1.3",
    text: "Kann jemand das Ticket prüfen?",
    createdAt: "2026-01-01T10:00:00Z",
  },
  {
    messageId: "m2",
    outcome: "nobody",
    fallback: "none",
    responders: [],
    answerProbability: 0.06,
    choices: [
      { agentId: null, name: "", probability: 0.91 },
      { agentId: "ed", name: "Ed", probability: 0.05 },
    ],
    model: "perplexity/pplx-decider-v1.3",
    text: "Danke!",
    createdAt: "2026-01-01T10:05:00Z",
  },
  {
    messageId: "m3",
    outcome: "mention",
    fallback: "none",
    responders: [{ id: "ed", name: "Ed" }],
    answerProbability: null,
    choices: [],
    model: null,
    text: "@Ed schau bitte drauf",
    createdAt: "2026-01-01T10:10:00Z",
  },
  {
    messageId: "m4",
    outcome: "unavailable",
    fallback: "model_failed",
    responders: [],
    answerProbability: null,
    choices: [],
    model: null,
    text: "Wer macht das?",
    createdAt: "2026-01-01T10:15:00Z",
  },
];

function fetcher(initialData: unknown = undefined): FakeFetcher {
  return {
    data: initialData,
    state: "idle",
    submit: vi.fn<(...args: unknown[]) => void>(),
  };
}

function renderPopup(
  settings: ConversationReplySettingsView | null,
  options: {
    decisions?: readonly ConversationDecisionEntry[];
    saved?: unknown;
  } = {},
): { readonly writer: FakeFetcher; readonly reader: FakeFetcher } {
  const reader = fetcher(
    settings === null
      ? undefined
      : { ok: true, intent: "reply-settings", replySettings: settings },
  );
  const decisions = fetcher(
    options.decisions === undefined
      ? undefined
      : {
          ok: true,
          intent: "reply-decisions",
          replyDecisions: options.decisions,
        },
  );
  const writer = fetcher(options.saved);
  fetchers.list = [reader, decisions, writer];
  fetchers.calls = 0;
  render(
    <I18nextProvider i18n={i18n}>
      <ChatPageReplySettings
        group={group("g", { name: "Team" })}
        isOpen
        onOpenChange={vi.fn()}
      />
    </I18nextProvider>,
  );
  return { writer, reader };
}

function slider(name: string): HTMLInputElement {
  const element = screen.getByRole("slider", { name });
  if (!(element instanceof HTMLInputElement))
    throw new Error("range input expected");
  return element;
}

function submitted(writer: FakeFetcher): Record<string, unknown> {
  const formData: unknown = writer.submit.mock.calls[0]?.[0];
  return formData instanceof FormData
    ? Object.fromEntries(formData.entries())
    : {};
}

beforeEach(() => {
  fetchers.list = [];
  fetchers.calls = 0;
});

it('shows the tab "Answers" with both modes, the decision model of the instance and the sliders at the defaults', () => {
  renderPopup(SETTINGS);
  expect(
    screen.getByRole("dialog", { name: "Who answers in “Team”?" }),
  ).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Answers" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Latest decisions" })).toBeTruthy();
  const modes = screen.getByRole("group", { name: "Who answers?" });
  expect(
    within(modes)
      .getByRole("button", { name: "@ + Decision" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    within(modes)
      .getByRole("button", { name: "@ only" })
      .getAttribute("aria-pressed"),
  ).toBe("false");
  expect(
    screen.getByText(/Like “@ only”\. When a message contains no @/),
  ).toBeTruthy();
  expect(screen.getByText("Perplexity Decider V1.3")).toBeTruthy();
  expect(slider("Answer threshold").value).toBe("60");
  expect(slider("Responsibility threshold").value).toBe("50");
  expect(slider("Second threshold").value).toBe("40");
  expect(slider("Most answering agents").value).toBe("2");
  expect(screen.queryByRole("alert")).toBeNull();
});

it('switches the sliders off in the mode "@ only" and on again in "@ + Decision"', () => {
  renderPopup(SETTINGS);
  const modes = screen.getByRole("group", { name: "Who answers?" });
  fireEvent.click(within(modes).getByRole("button", { name: "@ only" }));
  expect(
    screen.getByText("Only the agents named with @Name answer."),
  ).toBeTruthy();
  for (const name of [
    "Answer threshold",
    "Responsibility threshold",
    "Second threshold",
    "Most answering agents",
  ])
    expect(slider(name).disabled).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Reset to default",
    }).disabled,
  ).toBe(true);
  fireEvent.click(within(modes).getByRole("button", { name: "@ + Decision" }));
  expect(slider("Answer threshold").disabled).toBe(false);
});

it("saves mode, thresholds and maximum of the group", () => {
  const { writer } = renderPopup(SETTINGS);
  fireEvent.change(slider("Answer threshold"), { target: { value: "75" } });
  fireEvent.change(slider("Most answering agents"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(submitted(writer)).toEqual({
    intent: "save-reply-settings",
    conversationId: "g",
    mode: "decision",
    automaticRepliesPerOrigin: "8",
    useDefaults: "false",
    answerThreshold: "75",
    responsibilityThreshold: "50",
    secondThreshold: "40",
    maximumResponders: "3",
  });
});

it("saves only the mode while the group follows the defaults of the instance", () => {
  const { writer } = renderPopup(SETTINGS);
  fireEvent.click(
    within(screen.getByRole("group", { name: "Who answers?" })).getByRole(
      "button",
      {
        name: "@ only",
      },
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(submitted(writer)).toEqual({
    intent: "save-reply-settings",
    conversationId: "g",
    mode: "mentions",
    automaticRepliesPerOrigin: "8",
    useDefaults: "true",
  });
});

it('returns the sliders to the defaults with "Reset to default" and saves that', () => {
  const own = {
    ...SETTINGS,
    isDefault: false,
    rules: {
      ...CONVERSATION_DEFAULT_DECISION_RULES,
      answerThreshold: 90,
      maximumResponders: 1,
    },
  };
  const { writer } = renderPopup(own);
  expect(slider("Answer threshold").value).toBe("90");
  fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
  expect(slider("Answer threshold").value).toBe("60");
  expect(slider("Most answering agents").value).toBe("2");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(submitted(writer).useDefaults).toBe("true");
});

it("lets a member who does not manage the group read but not change it", () => {
  renderPopup({ ...SETTINGS, canManage: false });
  expect(slider("Answer threshold").disabled).toBe(true);
  expect(
    within(
      screen.getByRole("group", { name: "Who answers?" }),
    ).getByRole<HTMLButtonElement>("button", {
      name: "@ only",
    }).disabled,
  ).toBe(true);
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(
    screen.getByText("Only whoever manages the chat may change this."),
  ).toBeTruthy();
});

it.each([
  ["noModel", /No decision model is set\. The group behaves like “@ only”/],
  ["modelUnavailable", /no longer available\. The group behaves like “@ only”/],
  ["modelFailed", /last unreachable or gave no valid answer/],
] as const)("tells the manager about %s", (hint, text) => {
  renderPopup({ ...SETTINGS, hint });
  expect(screen.getByRole("alert").textContent).toMatch(text);
});

it("names a model that is not chosen yet", () => {
  renderPopup({
    ...SETTINGS,
    decisionModel: { status: "noModel", name: null },
    hint: "noModel",
  });
  expect(screen.getByText("No model chosen")).toBeTruthy();
});

it("confirms a save", () => {
  const saved = renderPopup(SETTINGS, {
    saved: { ok: true, intent: "save-reply-settings", replySettings: SETTINGS },
  });
  expect(saved.writer.submit).not.toHaveBeenCalled();
  expect(screen.getByText("Setting saved.")).toBeTruthy();
});

it("reports a failed save", () => {
  renderPopup(SETTINGS, {
    saved: { ok: false, intent: "save-reply-settings" },
  });
  expect(screen.getByRole("alert").textContent).toBe(
    "The setting could not be saved.",
  );
});

it("says that the settings could not be loaded when none arrive", () => {
  renderPopup(null);
  expect(screen.getByText("The setting could not be loaded.")).toBeTruthy();
});

it("lists the last decisions with time, message, expected answer, distribution and result", () => {
  renderPopup(SETTINGS, { decisions: DECISIONS });
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Latest decisions" }), {
    button: 0,
  });
  fireEvent.click(screen.getByRole("tab", { name: "Latest decisions" }));
  const items = screen.getAllByRole("listitem");
  expect(items).toHaveLength(4);
  const [responders, nobody, mention, unavailable] = items;
  expect(responders?.textContent).toContain("Kann jemand das Ticket prüfen?");
  expect(responders?.textContent).toContain("82 %");
  expect(responders?.textContent).toContain("Ed 78 %, Mei 15 %, nobody 7 %");
  expect(responders?.textContent).toContain("Answer from Ed");
  expect(nobody?.textContent).toContain("Danke!");
  expect(nobody?.textContent).toContain("nobody 91 %, Ed 5 %");
  expect(nobody?.textContent).toContain("no answer");
  expect(mention?.textContent).toContain("@ → Ed");
  expect(mention?.textContent).toContain("—");
  expect(unavailable?.textContent).toContain(
    "Decision model failed · like “@ only”",
  );
});

it("says that there are no decisions yet", () => {
  renderPopup(SETTINGS, { decisions: [] });
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Latest decisions" }), {
    button: 0,
  });
  fireEvent.click(screen.getByRole("tab", { name: "Latest decisions" }));
  expect(screen.getByText("No decisions yet.")).toBeTruthy();
});

it("reads the settings and the decisions whenever it opens", () => {
  const { reader } = renderPopup(SETTINGS);
  const first = reader.submit.mock.calls[0]?.[0];
  expect(
    first instanceof FormData ? Object.fromEntries(first.entries()) : {},
  ).toEqual({
    intent: "reply-settings",
    conversationId: "g",
  });
  const second = fetchers.list[1]?.submit.mock.calls[0]?.[0];
  expect(
    second instanceof FormData ? Object.fromEntries(second.entries()) : {},
  ).toEqual({
    intent: "reply-decisions",
    conversationId: "g",
  });
});
