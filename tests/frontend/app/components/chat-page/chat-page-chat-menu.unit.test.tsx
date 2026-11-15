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
  sessionBrief,
  sessionOverview,
  stubSessionEndpoint,
} from "../agent-settings/agent-session-fixture";
import { group, participant } from "./chat-page-fixture";

import type { ComponentProps } from "react";
import type { VirtualGroup } from "@/definition/VirtualChat";

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
const MEI = participant("mei", { name: "Mei", username: "mei-user" });
const BOB = participant("bob", {
  name: "Bob",
  kind: "human",
  role: "",
  username: "bobby",
});

type HeaderProps = ComponentProps<typeof ChatPageHeader>;

function renderGroup(
  overrides: Partial<VirtualGroup> = {},
  props: Partial<HeaderProps> = {},
): {
  readonly onToggleMute: ReturnType<typeof vi.fn>;
  readonly onToggleConfidential: ReturnType<typeof vi.fn>;
  readonly onAddMember: ReturnType<typeof vi.fn>;
} {
  const onToggleMute = vi.fn();
  const onToggleConfidential = vi.fn();
  const onAddMember = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <ChatPageHeader
        opened={{
          kind: "group",
          group: group("g", {
            name: "Team",
            memberIds: ["ed", "mei", "bob"],
            ...overrides,
          }),
          members: [ED, MEI, BOB],
        }}
        participants={[ED, MEI, BOB]}
        isAnswering={false}
        onStop={vi.fn()}
        onAddMember={onAddMember}
        isMuted={false}
        onToggleMute={onToggleMute}
        confidential={{
          isConfidential: false,
          onToggle: onToggleConfidential,
        }}
        {...props}
      />
    </I18nextProvider>,
  );
  return { onToggleMute, onToggleConfidential, onAddMember };
}

function openMenu(): void {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Chat menu" }), {
    button: 0,
    ctrlKey: false,
  });
}

function entry(name: RegExp | string): HTMLElement {
  return screen.getByRole("menuitem", { name });
}

function toggle(name: RegExp | string): HTMLElement {
  return screen.getByRole("menuitemcheckbox", { name });
}

function submitted(call: number): Record<string, unknown> {
  const formData: unknown = router.fetcher.submit.mock.calls[call]?.[0];
  return formData instanceof FormData
    ? Object.fromEntries(formData.entries())
    : {};
}

const WORKING = sessionBrief({
  sessionId: "s-ed",
  agentId: "ed",
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

it("replaces the single buttons of the head by the chat menu ☰ at its right edge", () => {
  renderGroup(
    { workingAgents: [{ id: "ed", name: "Ed" }] },
    { onStopAgent: vi.fn() },
  );
  for (const name of [
    "Group context",
    "Who answers?",
    "Confidential",
    "Not confidential",
    "Mute",
    "Embedded websites",
    "Group menu",
  ]) {
    expect(screen.queryByRole("button", { name })).toBeNull();
  }
  const trigger = screen.getByRole("button", { name: "Chat menu" });
  const aside = trigger.parentElement as HTMLElement;
  // The menu is the last control of the head; chips and stop buttons stay.
  expect(aside.lastElementChild).toBe(trigger);
  expect(within(aside).getByRole("list", { name: "Members" })).toBeTruthy();
  expect(within(aside).getByRole("button", { name: "Stop Ed" })).toBeTruthy();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  openMenu();
  expect(trigger.getAttribute("data-state")).toBe("open");
});

it("builds the group menu with its head and sections", () => {
  renderGroup();
  openMenu();
  const menu = screen.getByRole("menu");
  expect(within(menu).getByText("Team")).toBeTruthy();
  expect(within(menu).getByText("Group · 4 members")).toBeTruthy();
  const content = within(menu).getByRole("group", { name: "Content" });
  expect(
    within(content)
      .getAllByRole("menuitem")
      .map((item) => item.dataset.chatMenuEntry),
  ).toEqual(["media", "context"]);
  const collaboration = within(menu).getByRole("group", {
    name: "Collaboration",
  });
  expect(
    within(collaboration)
      .getAllByRole("menuitem")
      .map((item) => item.dataset.chatMenuEntry),
  ).toEqual(["members", "reply", "sessions"]);
  expect(within(entry(/^Members/)).getByText("4")).toBeTruthy();
  const settings = within(menu).getByRole("group", { name: "Settings" });
  expect(
    within(settings)
      .getAllByRole("menuitemcheckbox")
      .map((item) => item.textContent),
  ).toEqual(["Confidential", "Mute"]);
});

it("names the current mode as the remark of the entry who answers", () => {
  renderGroup({ replyMode: "mentions" });
  openMenu();
  expect(within(entry(/^Who answers\?/)).getByText("@ only")).toBeTruthy();
});

it('names "@ + Decision" for a group without a mode of its own', () => {
  renderGroup();
  openMenu();
  expect(
    within(entry(/^Who answers\?/)).getByText("@ + Decision"),
  ).toBeTruthy();
});

it("opens who answers and reads its settings and its last decisions", () => {
  renderGroup();
  openMenu();
  fireEvent.click(entry(/^Who answers\?/));
  expect(
    screen.getByRole("dialog", { name: "Who answers in “Team”?" }),
  ).toBeTruthy();
  expect(submitted(0)).toEqual({
    intent: "reply-settings",
    conversationId: "g",
  });
  expect(submitted(1)).toEqual({
    intent: "reply-decisions",
    conversationId: "g",
  });
});

it("opens the group context and reads it", () => {
  renderGroup();
  openMenu();
  fireEvent.click(entry("Group context"));
  expect(
    screen.getByRole("dialog", { name: "Group context of Team" }),
  ).toBeTruthy();
  expect(submitted(0)).toEqual({
    intent: "group-context",
    conversationId: "g",
  });
});

it("shows the confidential and the mute state as switches", () => {
  renderGroup(
    {},
    {
      isMuted: true,
      confidential: { isConfidential: true, onToggle: vi.fn() },
    },
  );
  openMenu();
  expect(toggle("Confidential").getAttribute("aria-checked")).toBe("true");
  expect(toggle("Mute").getAttribute("aria-checked")).toBe("true");
});

it("switches confidential directly in the menu, which stays open", () => {
  const { onToggleConfidential } = renderGroup();
  openMenu();
  expect(toggle("Confidential").getAttribute("aria-checked")).toBe("false");
  fireEvent.click(toggle("Confidential"));
  expect(onToggleConfidential).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("menu")).toBeTruthy();
});

it("mutes the group directly in the menu", () => {
  const { onToggleMute } = renderGroup();
  openMenu();
  fireEvent.click(toggle("Mute"));
  expect(onToggleMute).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("menu")).toBeTruthy();
});

it("leaves out the switches of what the group cannot do", () => {
  renderGroup({}, { isMuted: null, confidential: undefined });
  openMenu();
  expect(screen.queryByRole("menuitemcheckbox")).toBeNull();
  expect(screen.queryByRole("group", { name: "Settings" })).toBeNull();
});

it("offers dissolving, apart and red, only to the creator of the group", () => {
  renderGroup({ isOwner: true });
  openMenu();
  const dissolve = entry("Dissolve group");
  expect(dissolve.className).toContain("text-destructive");
  fireEvent.click(dissolve);
  expect(screen.getByRole("dialog", { name: /Dissolve/ })).toBeTruthy();
});

it("leaves out dissolving for a member who did not create the group", () => {
  renderGroup({ isOwner: false });
  openMenu();
  expect(screen.queryByRole("menuitem", { name: "Dissolve group" })).toBeNull();
});

it("offers the model per chat only with the right to steer the agents", () => {
  renderGroup({ canControlSessions: false });
  openMenu();
  expect(
    screen.queryByRole("menuitem", { name: /^Model for this chat/ }),
  ).toBeNull();
});

it("asks which agent's model changes when several agents take part", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ ok: true, models: [] }));
  renderGroup({
    canControlSessions: true,
    agentModels: { ed: { name: "Claude Opus 5.5", reasoningEffort: "high", isOverride: true, contextWindow: null } },
  });
  openMenu();
  const model = entry(/^Model for this chat/);
  expect(within(model).getByText("1 changed")).toBeTruthy();
  fireEvent.keyDown(model, { key: "ArrowRight" });
  const edEntry = await screen.findByRole("menuitem", { name: /^Ed/ });
  expect(within(edEntry).getByText("Opus · high")).toBeTruthy();
  expect(
    within(screen.getByRole("menuitem", { name: /^Mei/ })).getByText("Default"),
  ).toBeTruthy();
  fireEvent.click(edEntry);
  expect(
    await screen.findByRole("dialog", { name: /Model for Ed/ }),
  ).toBeTruthy();
});

it("moves through the entries with the arrow keys and closes with Esc", async () => {
  renderGroup();
  openMenu();
  const menu = screen.getByRole("menu");
  await waitFor(() => expect(document.activeElement).toBe(menu));
  fireEvent.keyDown(menu, { key: "ArrowDown" });
  await waitFor(() =>
    expect(document.activeElement?.getAttribute("data-chat-menu-entry")).toBe(
      "media",
    ),
  );
  fireEvent.keyDown(document.activeElement as HTMLElement, {
    key: "ArrowDown",
  });
  await waitFor(() =>
    expect(document.activeElement?.getAttribute("data-chat-menu-entry")).toBe(
      "context",
    ),
  );
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Enter" });
  expect(
    await screen.findByRole("dialog", { name: "Group context of Team" }),
  ).toBeTruthy();
});

it("closes with Esc", () => {
  renderGroup();
  openMenu();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
});

it("opens the members from the menu, where the dashed plus of the head moved to (PAGE-380)", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json({
      ok: true,
      members: {
        groupId: "g",
        canManage: true,
        members: [
          {
            id: "igor",
            name: "Igor",
            kind: "human",
            username: "igor",
            role: "",
            color: null,
            avatarImageUrl: null,
            isOwner: true,
            canControl: true,
          },
        ],
      },
    }),
  );
  const { onAddMember } = renderGroup({ memberIds: ["ed"], isOwner: true });
  expect(screen.queryByRole("button", { name: "Add participant" })).toBeNull();
  openMenu();
  fireEvent.click(entry(/^Members/));
  const dialog = screen.getByRole("dialog", { name: "Members of “Team”" });
  expect(await within(dialog).findByText("Owner")).toBeTruthy();
  fireEvent.change(
    within(dialog).getByPlaceholderText("Add person or agent …"),
    {
      target: { value: "Bo" },
    },
  );
  fireEvent.click(within(dialog).getByRole("button", { name: /Bob/ }));
  expect(onAddMember).toHaveBeenCalledWith("g", "bob");
  vi.unstubAllGlobals();
});

it("lists the session of every agent of the group with its state, context and waiting messages", () => {
  renderGroup({ agentSessions: [WORKING] });
  openMenu();
  fireEvent.click(entry("Sessions of the agents"));
  const dialog = screen.getByRole("dialog", {
    name: "Sessions of the agents in Team",
  });
  const rows = within(
    within(dialog).getByRole("list", {
      name: "Agents and their sessions in this chat",
    }),
  ).getAllByRole("listitem");
  // Ed and Mei are agents; Bob is a person and has no session.
  expect(rows).toHaveLength(2);
  const [edRow, meiRow] = rows;
  expect(within(edRow).getByText("Ed")).toBeTruthy();
  expect(within(edRow).getByText("working")).toBeTruthy();
  expect(within(edRow).getByRole("meter").getAttribute("aria-valuenow")).toBe(
    "58",
  );
  expect(within(edRow).getByText("2 messages waiting")).toBeTruthy();
  expect(within(meiRow).getByText("No session yet")).toBeTruthy();
  expect(
    within(meiRow).queryByRole("button", { name: /Summarize/ }),
  ).toBeNull();
});

it("stops, summarizes and restarts a session from the sessions dialog and reads the page again", async () => {
  const { calls } = stubSessionEndpoint(() => ({
    ok: true,
    overview: sessionOverview(),
  }));
  renderGroup({ agentSessions: [WORKING] });
  openMenu();
  fireEvent.click(entry("Sessions of the agents"));
  fireEvent.click(
    screen.getByRole("button", { name: "Summarize session: Ed" }),
  );
  await waitFor(() => expect(router.revalidate).toHaveBeenCalledTimes(1));
  expect(calls[0]).toMatchObject({
    method: "POST",
    fields: { intent: "summarize", agentId: "ed", sessionId: "s-ed" },
  });
  expect(
    screen
      .getByRole("button", { name: "Stop session: Ed" })
      .hasAttribute("disabled"),
  ).toBe(false);
});

it("tells when a session action of the sessions dialog was refused", async () => {
  stubSessionEndpoint(() => ({ ok: false, error: "unavailable" }));
  renderGroup({ agentSessions: [WORKING] });
  openMenu();
  fireEvent.click(entry("Sessions of the agents"));
  fireEvent.click(screen.getByRole("button", { name: "Restart session: Ed" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "The session action failed.",
  );
});

it("opens the popup of an agent from the sessions dialog and leaves that dialog", async () => {
  stubSessionEndpoint(() => ({ ok: true, overview: sessionOverview() }));
  renderGroup({ agentSessions: [WORKING] });
  openMenu();
  fireEvent.click(entry("Sessions of the agents"));
  const [settingsLink] = screen.getAllByRole("button", {
    name: "Agent settings …",
  });
  fireEvent.click(settingsLink);
  expect(
    await screen.findByRole("heading", { name: "Ed · Agent settings" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("dialog", { name: "Sessions of the agents in Team" }),
  ).toBeNull();
});

it("leaves out the sessions and the model when the group has only people", () => {
  render(
    <I18nextProvider i18n={i18n}>
      <ChatPageHeader
        opened={{
          kind: "group",
          group: group("g", {
            name: "People",
            memberIds: ["bob"],
            canControlSessions: true,
          }),
          members: [BOB],
        }}
        participants={[BOB]}
        isAnswering={false}
        onStop={vi.fn()}
        onAddMember={vi.fn()}
        isMuted={false}
        onToggleMute={vi.fn()}
      />
    </I18nextProvider>,
  );
  openMenu();
  expect(
    screen.queryByRole("menuitem", { name: "Sessions of the agents" }),
  ).toBeNull();
  expect(
    screen.queryByRole("menuitem", { name: /^Model for this chat/ }),
  ).toBeNull();
  expect(screen.getByText("Group · 2 members")).toBeTruthy();
});

it("keeps the stop button of an answering agent next to the menu", () => {
  const onStopAgent = vi.fn();
  renderGroup({ workingAgents: [{ id: "ed", name: "Ed" }] }, { onStopAgent });
  fireEvent.click(screen.getByRole("button", { name: "Stop Ed" }));
  expect(onStopAgent).toHaveBeenCalledWith("ed");
});

it("offers only the media in a conversation of agents only", () => {
  renderGroup({ isAgentConversation: true });
  openMenu();
  expect(
    screen.getAllByRole("menuitem").map((item) => item.dataset.chatMenuEntry),
  ).toEqual(["media"]);
  expect(screen.queryByRole("menuitemcheckbox")).toBeNull();
});
