import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ChatPageHeader } from "@/app/components/chat-page/chat-page-header";
import { createI18n } from "@/app/lib/i18n";

import {
  dreamingOverview,
  stubDreamingEndpoints,
} from "../agent-settings/agent-dreaming-fixture";
import {
  logbookEntry,
  logbookOverview,
  stubLogbookEndpoint,
} from "../agent-settings/agent-logbook-fixture";
import {
  sessionBrief,
  sessionOverview,
  sessionView,
  stubSessionEndpoint,
} from "../agent-settings/agent-session-fixture";
import { group, participant } from "./chat-page-fixture";

import type { ComponentProps } from "react";
import type { AgentChatSessionBrief } from "@/definition/AgentChatSession";
import type { VirtualParticipant } from "@/definition/VirtualChat";

const router = vi.hoisted(() => ({
  revalidate: vi.fn(),
  fetcher: { data: undefined, state: "idle", submit: vi.fn() },
}));
vi.mock("react-router", () => ({
  useFetcher: () => router.fetcher,
  useRevalidator: () => ({ state: "idle", revalidate: router.revalidate }),
}));

const i18n = createI18n("en");
const ED = participant("ed", { name: "Ed", username: "ed-user", role: "Dev" });
const BOB = participant("bob", {
  name: "Bob",
  kind: "human",
  role: "",
  username: "bobby",
});

type HeaderProps = ComponentProps<typeof ChatPageHeader>;

function renderHeader(props: Partial<HeaderProps> = {}): {
  readonly onSelect: ReturnType<typeof vi.fn>;
  readonly onMention: ReturnType<typeof vi.fn>;
} {
  const onSelect = vi.fn();
  const onMention = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <ChatPageHeader
        opened={{ kind: "participant", participant: ED }}
        participants={[ED, BOB]}
        isAnswering={false}
        onStop={vi.fn()}
        onAddMember={vi.fn()}
        onSelect={onSelect}
        onMention={onMention}
        isMuted={null}
        onToggleMute={vi.fn()}
        {...props}
      />
    </I18nextProvider>,
  );
  return { onSelect, onMention };
}

function renderGroup(
  briefs: readonly AgentChatSessionBrief[] | undefined,
  props: Partial<HeaderProps> = {},
): ReturnType<typeof renderHeader> {
  return renderHeader({
    opened: {
      kind: "group",
      group: group("g", {
        name: "Team",
        memberIds: ["ed", "bob"],
        agentSessions: briefs,
      }),
      members: [ED, BOB],
    },
    ...props,
  });
}

function chip(): HTMLElement {
  return screen.getByRole("button", { name: /^Ed/ });
}

function openByClick(trigger: HTMLElement): void {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
}

function item(name: RegExp | string): HTMLElement {
  return screen.getByRole("menuitem", { name });
}

function isOff(element: HTMLElement): boolean {
  return element.getAttribute("aria-disabled") === "true";
}

const WORKING = sessionBrief({
  sessionId: "s-ed",
  state: "working",
  contextPercent: 58,
  waitingMessages: 2,
});

beforeEach(() => {
  router.revalidate.mockReset();
  router.fetcher.submit.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([
  ["working", "working …"],
  ["ready", "ready"],
  ["resting", "resting"],
  ["restart_needed", "restart needed"],
] as const)(
  "shows the %s state of an agent on its chip in a group",
  (state, text) => {
    renderGroup([sessionBrief({ state })]);
    expect(within(chip()).getByText(text)).toBeTruthy();
  },
);

it("shows the messages waiting for an agent with the plural of the language", () => {
  renderGroup([sessionBrief({ waitingMessages: 1 })]);
  expect(within(chip()).getByText("1 message waiting")).toBeTruthy();
});

it("shows the plural for several waiting messages and none for no waiting message", () => {
  renderGroup([WORKING]);
  expect(within(chip()).getByText("2 messages waiting")).toBeTruthy();
});

it("shows no status for an agent without a session and none for a person", () => {
  renderGroup([]);
  expect(chip().textContent).toBe("EEd");
  expect(
    screen.getByText("Bob").closest("li")?.querySelector("button"),
  ).toBeNull();
});

it("shows the state of the agent next to its menu in the direct chat", () => {
  renderHeader({
    opened: {
      kind: "participant",
      participant: { ...ED, session: sessionBrief({ state: "resting" }) },
    },
  });
  expect(screen.getByText("resting")).toBeTruthy();
});

it("opens the menu of an agent with a click on its chip and shows its state in this chat", () => {
  renderGroup([WORKING]);
  openByClick(chip());
  expect(screen.getByText("Ed · in this chat")).toBeTruthy();
  expect(screen.getByText("Status: working · 58 % context")).toBeTruthy();
  for (const name of [
    "Stop session",
    "Summarize session",
    "Restart session",
    /^Agent settings …\s*Sessions$/,
    /^Logbook …/,
    /^Dreaming, lessons & recipes …/,
    "Open direct chat with Ed",
    "Mention Ed",
  ]) {
    expect(item(name)).toBeTruthy();
  }
});

it("opens the same menu with a right click and keeps the browser menu away", () => {
  renderGroup([WORKING]);
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  fireEvent(chip(), event);
  expect(event.defaultPrevented).toBe(true);
  expect(screen.getByText("Status: working · 58 % context")).toBeTruthy();
});

it("words the status of every state and leaves out an unknown context", () => {
  renderGroup([
    sessionBrief({ state: "restart_needed", contextPercent: null }),
  ]);
  openByClick(chip());
  expect(screen.getByText("Status: restart needed")).toBeTruthy();
});

it("says that there is no session yet and switches the session entries off", () => {
  renderGroup([]);
  openByClick(chip());
  expect(screen.getByText("No session in this chat yet")).toBeTruthy();
  for (const name of ["Stop session", "Summarize session", "Restart session"]) {
    expect(isOff(item(name))).toBe(true);
  }
  expect(isOff(item(/^Agent settings/))).toBe(false);
});

it("stops only a session that works", () => {
  renderGroup([sessionBrief({ state: "ready" })]);
  openByClick(chip());
  expect(isOff(item("Stop session"))).toBe(true);
  expect(isOff(item("Summarize session"))).toBe(false);
  expect(isOff(item("Restart session"))).toBe(false);
});

it.each([
  ["Stop session", "stop"],
  ["Summarize session", "summarize"],
  ["Restart session", "restart"],
] as const)(
  "sends %s with the session of this chat and reads the page again",
  async (name, intent) => {
    const { calls } = stubSessionEndpoint(() => ({
      ok: true,
      overview: sessionOverview(),
    }));
    renderGroup([WORKING]);
    openByClick(chip());
    fireEvent.click(item(name));
    await waitFor(() => expect(router.revalidate).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "/chat-page-api/agent-sessions",
      method: "POST",
      fields: { intent, agentId: "ed", sessionId: "s-ed" },
    });
  },
);

it("tells when the server refused the session action and does not read the page again", async () => {
  stubSessionEndpoint(() => ({ ok: false, error: "forbidden" }));
  renderGroup([WORKING]);
  openByClick(chip());
  fireEvent.click(item("Restart session"));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "The session action failed.",
  );
  expect(router.revalidate).not.toHaveBeenCalled();
});

it("opens the popup for the agent in the tab Sessions with the opened group marked", async () => {
  const { calls } = stubSessionEndpoint(() => ({
    ok: true,
    overview: sessionOverview({
      sessions: [
        sessionView("s-ed", {
          chat: { kind: "group", id: "g", name: "Team", isConfidential: false },
        }),
        sessionView("s-other"),
      ],
    }),
  }));
  renderGroup([WORKING]);
  openByClick(chip());
  fireEvent.click(item(/^Agent settings/));
  expect(
    await screen.findByRole("heading", { name: "Ed · Agent settings" }),
  ).toBeTruthy();
  expect(screen.getByText("Dev")).toBeTruthy();
  const table = await screen.findByRole("table");
  const marked = within(table)
    .getAllByRole("row")
    .filter((row) => row.getAttribute("aria-current") === "true");
  expect(marked).toHaveLength(1);
  expect(within(marked[0] ?? table).getByText("Group “Team”")).toBeTruthy();
  expect(calls[0]?.url).toBe("/chat-page-api/agent-sessions?agentId=ed");
  expect(
    screen.getByRole("tab", { name: "Sessions" }).getAttribute("aria-selected"),
  ).toBe("true");
});

it("shows the entries of Dreaming, lessons & recipes and of the Logbook on, without a remark that they follow", () => {
  renderGroup([WORKING]);
  openByClick(chip());
  const dreaming = item(/^Dreaming, lessons & recipes …/);
  expect(isOff(dreaming)).toBe(false);
  expect(within(dreaming).queryByText("soon")).toBeNull();
  const logbook = item(/^Logbook …/);
  expect(isOff(logbook)).toBe(false);
  expect(within(logbook).queryByText("soon")).toBeNull();
});

it("opens the popup of the agent straight in the tab Dreaming from the entry Dreaming, lessons & recipes … of the menu (PAGE-378)", async () => {
  const { dreamingCalls } = stubDreamingEndpoints({
    dreaming: () => ({ ok: true, overview: dreamingOverview() }),
  });
  renderGroup([WORKING]);
  openByClick(chip());
  fireEvent.click(item(/^Dreaming, lessons & recipes …/));
  const dialog = await screen.findByRole("dialog");
  expect(
    within(dialog)
      .getByRole("tab", { name: "Dreaming" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(
    await within(dialog).findByRole("switch", { name: "Dreaming active" }),
  ).toBeTruthy();
  expect(dreamingCalls[0]?.url).toBe(
    "/chat-page-api/agent-dreaming?agentId=ed",
  );
});

it("opens the popup of the agent straight in the tab Logbook from the entry Logbook … of the menu (PAGE-377)", async () => {
  const { calls } = stubLogbookEndpoint(() => ({
    ok: true,
    overview: logbookOverview({ entries: [logbookEntry("e1")], count: 1 }),
  }));
  renderGroup([WORKING]);
  openByClick(chip());
  fireEvent.click(item(/^Logbook …/));
  const dialog = await screen.findByRole("dialog");
  expect(
    within(dialog).getByRole("tab", { name: "Logbook" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(
    await within(dialog).findByRole("table", { name: "Logbook of Ed" }),
  ).toBeTruthy();
  expect(calls[0]?.url).toBe("/chat-page-api/agent-logbook?agentId=ed");
});

it("opens the direct chat with the agent", () => {
  const { onSelect } = renderGroup([WORKING]);
  openByClick(chip());
  fireEvent.click(item("Open direct chat with Ed"));
  expect(onSelect).toHaveBeenCalledWith({ kind: "participant", id: "ed" });
});

it("offers no direct chat with an agent the person does not keep in their list", () => {
  renderGroup([WORKING], { participants: [BOB] });
  openByClick(chip());
  expect(
    screen.queryByRole("menuitem", { name: /Open direct chat/ }),
  ).toBeNull();
  expect(item("Mention Ed")).toBeTruthy();
});

it("puts the mention of the agent into the input field", () => {
  const { onMention } = renderGroup([WORKING]);
  openByClick(chip());
  fireEvent.click(item("Mention Ed"));
  expect(onMention).toHaveBeenCalledWith("ed-user");
});

it("leaves out direct chat and mention where the person already talks to the agent", () => {
  renderHeader({
    opened: {
      kind: "participant",
      participant: { ...ED, session: WORKING },
    },
  });
  openByClick(screen.getByRole("button", { name: "Agent menu" }));
  expect(screen.getByText("Status: working · 58 % context")).toBeTruthy();
  expect(
    screen.queryByRole("menuitem", { name: /Open direct chat/ }),
  ).toBeNull();
  expect(screen.queryByRole("menuitem", { name: /Mention/ })).toBeNull();
  expect(item(/^Agent settings/)).toBeTruthy();
});

it("opens the menu of the agent with a right click on the head of its direct chat", () => {
  renderHeader({
    opened: {
      kind: "participant",
      participant: { ...ED, session: WORKING },
    },
  });
  fireEvent.contextMenu(screen.getByRole("heading", { name: "Ed" }));
  expect(screen.getByText("Ed · in this chat")).toBeTruthy();
});

it("marks the session of the direct chat in the popup although the chat ID is not known", async () => {
  stubSessionEndpoint(() => ({
    ok: true,
    overview: sessionOverview({
      sessions: [sessionView("s-ed"), sessionView("s-other")],
    }),
  }));
  const withSession: VirtualParticipant = { ...ED, session: WORKING };
  renderHeader({ opened: { kind: "participant", participant: withSession } });
  openByClick(screen.getByRole("button", { name: "Agent menu" }));
  fireEvent.click(item(/^Agent settings/));
  const table = await screen.findByRole("table");
  const marked = within(table)
    .getAllByRole("row")
    .filter((row) => row.getAttribute("aria-current") === "true");
  expect(marked).toHaveLength(1);
});

it("shows no agent menu in the chat with a person", () => {
  renderHeader({ opened: { kind: "participant", participant: BOB } });
  expect(screen.queryByRole("button", { name: "Agent menu" })).toBeNull();
});

it("words the status and the entries in German", () => {
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <ChatPageHeader
        opened={{
          kind: "group",
          group: group("g", {
            name: "Team",
            memberIds: ["ed"],
            agentSessions: [WORKING],
          }),
          members: [ED],
        }}
        participants={[ED]}
        isAnswering={false}
        onStop={vi.fn()}
        onAddMember={vi.fn()}
        onSelect={vi.fn()}
        onMention={vi.fn()}
        isMuted={null}
        onToggleMute={vi.fn()}
      />
    </I18nextProvider>,
  );
  expect(within(chip()).getByText("arbeitet …")).toBeTruthy();
  expect(within(chip()).getByText("2 Nachrichten warten")).toBeTruthy();
  openByClick(chip());
  expect(screen.getByText("Ed · in diesem Chat")).toBeTruthy();
  expect(screen.getByText("Status: arbeitet · 58 % Kontext")).toBeTruthy();
  for (const name of [
    "Sitzung anhalten",
    "Sitzung zusammenfassen",
    "Sitzung neu starten",
    "Direkt-Chat mit Ed öffnen",
    "Ed erwähnen",
  ]) {
    expect(item(name)).toBeTruthy();
  }
  expect(item(/^Agent-Einstellungen …\s*Sitzungen$/)).toBeTruthy();
  expect(isOff(item(/^Lagebuch …/))).toBe(false);
  const dreaming = item(/^Dreaming, Lektionen & Rezepte …/);
  expect(isOff(dreaming)).toBe(false);
  expect(within(dreaming).queryByText("folgt")).toBeNull();
});
