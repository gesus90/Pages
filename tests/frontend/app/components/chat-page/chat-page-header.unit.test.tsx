import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { ChatPageHeader } from "@/app/components/chat-page/chat-page-header";
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

it("offers no mute button when there is nothing to mute", () => {
  renderHeader({ isMuted: null });
  expect(screen.queryByRole("button", { name: /mute/i })).toBeNull();
});

it("mutes an unmuted conversation", () => {
  const { onToggleMute } = renderHeader({ isMuted: false });
  const button = screen.getByRole("button", { name: "Mute" });
  expect(button.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(button);
  expect(onToggleMute).toHaveBeenCalledTimes(1);
});

it("unmutes a muted conversation", () => {
  const { onToggleMute } = renderHeader({ isMuted: true });
  const button = screen.getByRole("button", { name: "Unmute" });
  expect(button.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(button);
  expect(onToggleMute).toHaveBeenCalledTimes(1);
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

it("mutes a group from the group menu", () => {
  const { onToggleMute } = renderHeader({
    opened: groupOpened([ADA]),
    isMuted: false,
  });
  expect(screen.queryByRole("button", { name: "Mute" })).toBeNull();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Group menu" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(screen.getByRole("menuitem", { name: "Mute" }));
  expect(onToggleMute).toHaveBeenCalledTimes(1);
});

it("adds one of the person's participants that is not yet a member", () => {
  const { onAddMember } = renderHeader({ opened: groupOpened([ADA]) });
  fireEvent.click(screen.getByRole("button", { name: "Add participant" }));
  expect(screen.queryByText("Planner")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Bob/ }));
  expect(onAddMember).toHaveBeenCalledWith("g", "bob");
});
