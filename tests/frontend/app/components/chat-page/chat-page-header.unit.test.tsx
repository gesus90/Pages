import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { ChatPageHeader } from "@/app/components/chat-page/chat-page-header";
import { ChatContentProvider } from "@/app/components/chat-page/content/chat-content-context";
import { createI18n } from "@/app/lib/i18n";

import { group, participant } from "./chat-page-fixture";

import type { ComponentProps } from "react";
import type { VirtualParticipant } from "@/definition/VirtualChat";

const fetcher = vi.hoisted(() => ({
  data: undefined,
  state: "idle",
  submit: vi.fn(),
}));
vi.mock("react-router", () => ({
  useFetcher: () => fetcher,
  useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
}));

const i18n = createI18n("en");
const ADA = participant("ada", { name: "Ada", role: "Planner" });
const BOB = participant("bob", {
  name: "Bob",
  kind: "human",
  role: "",
  username: "bobby",
  status: "working",
});

function renderHeader(
  props: Partial<ComponentProps<typeof ChatPageHeader>> = {},
): {
  readonly onStop: ReturnType<typeof vi.fn>;
  readonly onAddMember: ReturnType<typeof vi.fn>;
  readonly onToggleMute: ReturnType<typeof vi.fn>;
} {
  const onStop = vi.fn();
  const onAddMember = vi.fn();
  const onToggleMute = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <ChatPageHeader
        opened={{ kind: "participant", participant: ADA }}
        participants={[ADA, BOB]}
        isAnswering={false}
        onStop={onStop}
        onAddMember={onAddMember}
        isMuted={null}
        onToggleMute={onToggleMute}
        {...props}
      />
    </I18nextProvider>,
  );
  return { onStop, onAddMember, onToggleMute };
}

function groupOpened(
  members: readonly VirtualParticipant[],
): ComponentProps<typeof ChatPageHeader>["opened"] {
  return {
    kind: "group",
    group: group("g", {
      name: "Team",
      description: "Daily work",
      memberIds: members.map((member) => member.id),
    }),
    members,
  };
}

it("shows an agent with its job title, kind and status", () => {
  renderHeader();
  expect(screen.getByRole("heading", { name: "Ada" })).toBeTruthy();
  expect(screen.getByText("Planner · Agent · Active")).toBeTruthy();
});

it("shows a person with the username, kind and status", () => {
  renderHeader({ opened: { kind: "participant", participant: BOB } });
  expect(screen.getByText("@bobby · Person · Working")).toBeTruthy();
});

it("drops the empty job title of an agent from the subtitle", () => {
  renderHeader({
    opened: { kind: "participant", participant: { ...ADA, role: "" } },
  });
  expect(screen.getByText("Agent · Active")).toBeTruthy();
});

it("offers no stop button while the agent is idle", () => {
  renderHeader();
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
});

it("stops an answering agent", () => {
  const { onStop } = renderHeader({ isAnswering: true });
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(onStop).toHaveBeenCalledTimes(1);
});

it("offers no stop button for a person even if the page is answering", () => {
  renderHeader({
    opened: { kind: "participant", participant: BOB },
    isAnswering: true,
  });
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
});

function openChatMenu(): void {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Chat menu" }), {
    button: 0,
    ctrlKey: false,
  });
}

function menuEntries(): readonly (string | undefined)[] {
  return Array.from(
    screen.getByRole("menu").querySelectorAll<HTMLElement>("[data-chat-menu-entry]"),
  ).map((item) => item.dataset.chatMenuEntry);
}

it("keeps no single buttons for confidential, muting or embedded websites in the head", () => {
  renderHeader({
    isMuted: false,
    confidential: { isConfidential: false, onToggle: vi.fn() },
  });
  for (const name of [/mute/i, /confidential/i, "Embedded websites"]) {
    expect(screen.queryByRole("button", { name })).toBeNull();
  }
  expect(screen.getByRole("button", { name: "Chat menu" })).toBeTruthy();
});

it("offers no mute switch when there is nothing to mute", () => {
  renderHeader({ isMuted: null });
  openChatMenu();
  expect(screen.queryByRole("menuitemcheckbox", { name: "Mute" })).toBeNull();
});

it("mutes an unmuted conversation from the chat menu", () => {
  const { onToggleMute } = renderHeader({
    opened: { kind: "participant", participant: BOB },
    isMuted: false,
  });
  openChatMenu();
  const mute = screen.getByRole("menuitemcheckbox", { name: "Mute" });
  expect(mute.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(mute);
  expect(onToggleMute).toHaveBeenCalledTimes(1);
});

it("unmutes a muted conversation from the chat menu", () => {
  const { onToggleMute } = renderHeader({
    opened: { kind: "participant", participant: BOB },
    isMuted: true,
  });
  openChatMenu();
  const mute = screen.getByRole("menuitemcheckbox", { name: "Mute" });
  expect(mute.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(mute);
  expect(onToggleMute).toHaveBeenCalledTimes(1);
});

it("offers media, model, a new session and the confidential switch for an agent", () => {
  const onToggle = vi.fn();
  renderHeader({
    opened: {
      kind: "participant",
      participant: {
        ...ADA,
        chatModel: { name: "Claude Opus 5.5", reasoningEffort: "high", isOverride: true, contextWindow: null },
      },
    },
    confidential: { isConfidential: false, onToggle },
  });
  openChatMenu();
  expect(screen.getByText("Direct chat · Agent")).toBeTruthy();
  expect(menuEntries()).toEqual(["media", "model", "new", "confidential"]);
  expect(
    within(
      screen.getByRole("menuitem", { name: /^Model for this chat/ }),
    ).getByText("Opus · high"),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("menuitemcheckbox", { name: "Confidential" }),
  );
  expect(onToggle).toHaveBeenCalledTimes(1);
});

it("opens the model of the agent in this chat from the chat menu", () => {
  vi.stubGlobal("fetch", async () => Response.json({ ok: true, models: [] }));
  renderHeader();
  openChatMenu();
  fireEvent.click(
    screen.getByRole("menuitem", { name: /^Model for this chat/ }),
  );
  expect(
    screen.getByRole("dialog", { name: "Model for Ada in “Ada”" }),
  ).toBeTruthy();
  vi.unstubAllGlobals();
});

it("starts a new session of the agent as /new does", async () => {
  const bodies: Record<string, string>[] = [];
  vi.stubGlobal(
    "fetch",
    async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      if (init.body instanceof FormData)
        bodies.push(
          Object.fromEntries(
            [...init.body.entries()].map(([key, value]) => [
              key,
              String(value),
            ]),
          ),
        );
      return Response.json({ ok: true });
    },
  );
  renderHeader();
  openChatMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: /^New session/ }));
  await waitFor(() =>
    expect(bodies).toEqual([{ intent: "new", kind: "direct", agentId: "ada" }]),
  );
  vi.unstubAllGlobals();
});

it("offers embedded websites for a stored chat with a person, but no model", () => {
  const stored = { ...BOB, conversationId: "c-bob" };
  render(
    <I18nextProvider i18n={i18n}>
      <ChatContentProvider
        conversationId="c-bob"
        conversationKey="participant:bob"
        directory={{ viewPreferences: { cardStates: {}, splitWidth: null } }}
      >
        <ChatPageHeader
          opened={{ kind: "participant", participant: stored }}
          participants={[stored]}
          isAnswering={false}
          onStop={vi.fn()}
          onAddMember={vi.fn()}
          isMuted={false}
          onToggleMute={vi.fn()}
        />
      </ChatContentProvider>
    </I18nextProvider>,
  );
  openChatMenu();
  expect(screen.getByText("Direct chat · Person")).toBeTruthy();
  expect(menuEntries()).toEqual(["media", "embed", "mute"]);
  fireEvent.click(screen.getByRole("menuitem", { name: "Embedded websites" }));
  expect(
    screen.getByRole("dialog", { name: "Conversation settings" }),
  ).toBeTruthy();
});

it("shows a group with its description and member chips", () => {
  renderHeader({ opened: groupOpened([ADA, BOB]) });
  expect(screen.getByRole("heading", { name: "Team" })).toBeTruthy();
  expect(screen.getByText("Group · Daily work")).toBeTruthy();
  const chips = within(screen.getByRole("list", { name: "Members" }));
  // Each chip starts with the initial of the avatar.
  expect(
    chips.getAllByRole("listitem").map((chip) => chip.textContent),
  ).toEqual(["AAda", "BBob"]);
});

it("offers no stop button in a group", () => {
  renderHeader({ opened: groupOpened([ADA]), isAnswering: true });
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
});

it("mutes a group from the chat menu", () => {
  const { onToggleMute } = renderHeader({
    opened: groupOpened([ADA]),
    isMuted: false,
  });
  expect(screen.queryByRole("button", { name: "Mute" })).toBeNull();
  openChatMenu();
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Mute" }));
  expect(onToggleMute).toHaveBeenCalledTimes(1);
});

it("shows no dashed plus in the head: adding members moved into the group menu (PAGE-380)", () => {
  renderHeader({ opened: groupOpened([ADA]) });
  expect(screen.queryByRole("button", { name: "Add participant" })).toBeNull();
});
