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
  fireEvent.pointerDown(screen.getByRole("button", { name: "Group menu" }), {
    button: 0,
    ctrlKey: false,
  });
}

function entry(name: RegExp | string): HTMLElement {
  return screen.getByRole("menuitem", { name });
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

it("replaces the single buttons of the head by one menu", () => {
  renderGroup();
  for (const name of [
    "Group context",
    "Who answers?",
    "Confidential",
    "Not confidential",
    "Mute",
  ]) {
    expect(screen.queryByRole("button", { name })).toBeNull();
  }
  openMenu();
  expect(screen.getByText("Group “Team”")).toBeTruthy();
  for (const name of [
    /^Who answers\? …/,
    "Group context …",
    "Sessions of the agents in this chat …",
    /^Confidentiality\s*Not confidential$/,
    "Mute",
    "Manage members …",
  ]) {
    expect(entry(name)).toBeTruthy();
  }
});

it("names the current mode as the remark of the entry who answers", () => {
  renderGroup({ replyMode: "mentions" });
  openMenu();
  expect(within(entry(/^Who answers\? …/)).getByText("@ only")).toBeTruthy();
});

it("names \"@ + Decision\" for a group without a mode of its own", () => {
  renderGroup();
  openMenu();
  expect(
    within(entry(/^Who answers\? …/)).getByText("@ + Decision"),
  ).toBeTruthy();
});

it("opens who answers and reads its settings and its last decisions", () => {
  renderGroup();
  openMenu();
  fireEvent.click(entry(/^Who answers\? …/));
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
  fireEvent.click(entry("Group context …"));
  expect(
    screen.getByRole("dialog", { name: "Group context of Team" }),
  ).toBeTruthy();
  expect(submitted(0)).toEqual({
    intent: "group-context",
    conversationId: "g",
  });
});

it("shows the confidential state as the remark of its entry", () => {
  renderGroup(
    {},
    { confidential: { isConfidential: true, onToggle: vi.fn() } },
  );
  openMenu();
  expect(
    within(entry(/^Confidentiality/)).getByText("Confidential"),
  ).toBeTruthy();
});

it("calls the confidential change of the head", () => {
  const { onToggleConfidential } = renderGroup();
  openMenu();
  fireEvent.click(entry(/^Confidentiality/));
  expect(onToggleConfidential).toHaveBeenCalledTimes(1);
});

it("mutes the group from the menu", () => {
  const { onToggleMute } = renderGroup();
  openMenu();
  fireEvent.click(entry("Mute"));
  expect(onToggleMute).toHaveBeenCalledTimes(1);
});

it("names the entry Unmute for a muted group", () => {
  renderGroup({}, { isMuted: true });
  openMenu();
  expect(entry("Unmute")).toBeTruthy();
});

it("leaves out the entries of what the group cannot do", () => {
  renderGroup({}, { isMuted: null, confidential: undefined });
  openMenu();
  expect(screen.queryByRole("menuitem", { name: "Mute" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "Unmute" })).toBeNull();
  expect(
    screen.queryByRole("menuitem", { name: /Confidentiality/ }),
  ).toBeNull();
});

it("opens the member choice from the menu and from the dashed plus", () => {
  const { onAddMember } = renderGroup({ memberIds: ["ed"] });
  openMenu();
  fireEvent.click(entry("Manage members …"));
  expect(
    screen.getByRole("dialog", { name: "Add participant to Team" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Bob/ }));
  expect(onAddMember).toHaveBeenCalledWith("g", "bob");
  fireEvent.click(screen.getByRole("button", { name: "Add participant" }));
  expect(
    screen.getByRole("dialog", { name: "Add participant to Team" }),
  ).toBeTruthy();
});

it("lists the session of every agent of the group with its state, context and waiting messages", () => {
  renderGroup({ agentSessions: [WORKING] });
  openMenu();
  fireEvent.click(entry("Sessions of the agents in this chat …"));
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
  fireEvent.click(entry("Sessions of the agents in this chat …"));
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
  fireEvent.click(entry("Sessions of the agents in this chat …"));
  fireEvent.click(screen.getByRole("button", { name: "Restart session: Ed" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "The session action failed.",
  );
});

it("opens the popup of an agent from the sessions dialog and leaves that dialog", async () => {
  stubSessionEndpoint(() => ({ ok: true, overview: sessionOverview() }));
  renderGroup({ agentSessions: [WORKING] });
  openMenu();
  fireEvent.click(entry("Sessions of the agents in this chat …"));
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

it("says that no agent takes part when the group has only people", () => {
  render(
    <I18nextProvider i18n={i18n}>
      <ChatPageHeader
        opened={{
          kind: "group",
          group: group("g", { name: "People", memberIds: ["bob"] }),
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
  fireEvent.click(entry("Sessions of the agents in this chat …"));
  expect(screen.getByText("No agent takes part in this chat.")).toBeTruthy();
});

it("keeps the stop button of an answering agent next to the menu", () => {
  const onStopAgent = vi.fn();
  renderGroup({ workingAgents: [{ id: "ed", name: "Ed" }] }, { onStopAgent });
  fireEvent.click(screen.getByRole("button", { name: "Stop Ed" }));
  expect(onStopAgent).toHaveBeenCalledWith("ed");
});

it("shows no group menu for a conversation of agents only", () => {
  renderGroup({ isAgentConversation: true });
  expect(screen.queryByRole("button", { name: "Group menu" })).toBeNull();
});
