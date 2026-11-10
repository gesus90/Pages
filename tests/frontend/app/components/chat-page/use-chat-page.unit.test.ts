import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useChatPage } from "@/app/components/chat-page/use-chat-page";
import { CONVERSATION_VOICE_DEFAULT_DURATION_SECONDS } from "@/definition/Conversation";

import { directory, group, message, participant } from "./chat-page-fixture";

interface FetcherState {
  state: string;
  data: unknown;
  formData: FormData | undefined;
}

const submit = vi.hoisted(() => vi.fn());
const revalidate = vi.hoisted(() => vi.fn());
const fetcher = vi.hoisted((): FetcherState & { submit: unknown } => ({
  state: "idle",
  data: undefined,
  formData: undefined,
  submit,
}));
const revalidator = vi.hoisted(() => ({ state: "idle", revalidate }));
vi.mock("react-router", () => ({
  useFetcher: () => fetcher,
  useRevalidator: () => revalidator,
}));

function formEntries(call: unknown[] | undefined): Record<string, string> {
  const formData = call?.[0];
  if (!(formData instanceof FormData)) throw new Error("no form submitted");
  return Object.fromEntries(
    [...formData.entries()].map(([key, entry]) => [key, String(entry)]),
  );
}

function submissions(intent: string): Record<string, string>[] {
  return submit.mock.calls
    .map((call) => formEntries(call))
    .filter((entries) => entries["intent"] === intent);
}

beforeEach(() => {
  submit.mockReset();
  revalidate.mockReset();
  fetcher.state = "idle";
  fetcher.data = undefined;
  fetcher.formData = undefined;
  revalidator.state = "idle";
});

afterEach(() => {
  vi.useRealTimers();
});

it("opens the first group and lists both sides newest first", () => {
  const { result } = renderHook(() =>
    useChatPage(
      directory({
        participants: [
          participant("old", { lastActivityAt: "2026-10-01T00:00:00.000Z" }),
          participant("new", { lastActivityAt: "2026-11-05T00:00:00.000Z" }),
        ],
        groups: [
          group("g-old", { lastActivityAt: "2026-10-01T00:00:00.000Z" }),
          group("g-new", { lastActivityAt: "2026-11-05T00:00:00.000Z" }),
        ],
      }),
    ),
  );

  expect(result.current.selection).toEqual({ kind: "group", id: "g-new" });
  expect(result.current.allGroups.map((entry) => entry.id)).toEqual([
    "g-new",
    "g-old",
  ]);
  expect(result.current.allParticipants.map((entry) => entry.id)).toEqual([
    "new",
    "old",
  ]);
  expect(result.current.opened?.kind).toBe("group");
});

it("opens the first participant that can chat when there is no group", () => {
  const { result } = renderHook(() =>
    useChatPage(
      directory({
        participants: [
          participant("off", { canChat: false, status: "off" }),
          participant("ready"),
        ],
      }),
    ),
  );

  expect(result.current.selection).toEqual({
    kind: "participant",
    id: "ready",
  });
  expect(result.current.opened?.kind).toBe("participant");
  expect(
    result.current.opened?.kind === "participant"
      ? result.current.opened.participant.id
      : null,
  ).toBe("ready");
});

it("opens the first participant when none can chat", () => {
  const { result } = renderHook(() =>
    useChatPage(
      directory({ participants: [participant("off", { canChat: false })] }),
    ),
  );

  expect(result.current.selection).toEqual({
    kind: "participant",
    id: "off",
  });
});

it("opens nothing for an empty directory", () => {
  const { result } = renderHook(() => useChatPage(directory()));

  expect(result.current.selection).toBeNull();
  expect(result.current.opened).toBeNull();
  expect(result.current.messages).toEqual([]);
  expect(result.current.isAnswering).toBe(false);
  expect(result.current.answeringNames).toEqual([]);
  expect(result.current.isMuted).toBeNull();
});

it("opens a group with its known members in the group's order", () => {
  const { result } = renderHook(() =>
    useChatPage(
      directory({
        participants: [participant("a"), participant("b")],
        groups: [group("g", { memberIds: ["b", "missing", "a"] })],
      }),
    ),
  );

  expect(result.current.opened?.kind).toBe("group");
  const members =
    result.current.opened?.kind === "group"
      ? result.current.opened.members
      : [];
  expect(members.map((member) => member.id)).toEqual(["b", "a"]);
  const target = result.current.allGroups[0];
  expect(
    target ? result.current.findMembers(target).map((member) => member.id) : [],
  ).toEqual(["b", "a"]);
});

it("opens nothing for a selection that no list holds", () => {
  const { result } = renderHook(() =>
    useChatPage(
      directory({ participants: [participant("a")], groups: [group("g")] }),
    ),
  );

  act(() => result.current.select({ kind: "group", id: "gone" }));
  expect(result.current.opened).toBeNull();

  act(() => result.current.select({ kind: "participant", id: "gone" }));
  expect(result.current.opened).toBeNull();

  act(() => result.current.select({ kind: "participant", id: "a" }));
  expect(result.current.opened?.kind).toBe("participant");
});

it("finds a participant by id", () => {
  const { result } = renderHook(() =>
    useChatPage(directory({ participants: [participant("a")] })),
  );

  expect(result.current.findParticipant("a")?.name).toBe("Name a");
  expect(result.current.findParticipant("zzz")).toBeUndefined();
});

it("filters groups by name, description and member names", () => {
  const { result } = renderHook(() =>
    useChatPage(
      directory({
        participants: [
          participant("a", { name: "Marta" }),
          participant("b", { name: "Bruno" }),
        ],
        groups: [
          group("by-name", { name: "Launch Crew", description: "x" }),
          group("by-description", { name: "Other", description: "Quarterly" }),
          group("by-member", {
            name: "Third",
            description: "y",
            memberIds: ["a"],
          }),
        ],
      }),
    ),
  );

  act(() => result.current.setQuery("  LAUNCH "));
  expect(result.current.groups.map((entry) => entry.id)).toEqual(["by-name"]);

  act(() => result.current.setQuery("quarter"));
  expect(result.current.groups.map((entry) => entry.id)).toEqual([
    "by-description",
  ]);

  act(() => result.current.setQuery("marta"));
  expect(result.current.groups.map((entry) => entry.id)).toEqual(["by-member"]);

  act(() => result.current.setQuery("   "));
  expect(result.current.groups).toHaveLength(3);
  expect(result.current.query).toBe("   ");
});

it("filters participants by name, job title and username", () => {
  const { result } = renderHook(() =>
    useChatPage(
      directory({
        participants: [
          participant("a", { name: "Marta", role: "Planner", username: "m1" }),
          participant("b", { name: "Bruno", role: "Writer", username: "bru" }),
          participant("c", { name: "Clara", role: "", username: "clr" }),
        ],
      }),
    ),
  );

  act(() => result.current.setQuery("marta"));
  expect(result.current.participants.map((entry) => entry.id)).toEqual(["a"]);

  act(() => result.current.setQuery("writer"));
  expect(result.current.participants.map((entry) => entry.id)).toEqual(["b"]);

  act(() => result.current.setQuery("CLR"));
  expect(result.current.participants.map((entry) => entry.id)).toEqual(["c"]);

  act(() => result.current.setQuery("nothing"));
  expect(result.current.participants).toEqual([]);
  expect(result.current.allParticipants).toHaveLength(3);
});

it("shows the stored history of the opened conversation", () => {
  const history = [message("m1"), message("m2")];
  const { result } = renderHook(() =>
    useChatPage(
      directory({
        participants: [participant("a")],
        histories: { a: history },
      }),
    ),
  );

  expect(result.current.messages).toEqual(history);
});

it("takes the voice limit from the directory or falls back to the default", () => {
  const withLimit = renderHook(() =>
    useChatPage(directory({ voiceMaximumMs: 90_000 })),
  );
  expect(withLimit.result.current.voiceMaximumMs).toBe(90_000);

  const withDefault = renderHook(() => useChatPage(directory()));
  expect(withDefault.result.current.voiceMaximumMs).toBe(
    CONVERSATION_VOICE_DEFAULT_DURATION_SECONDS * 1000,
  );
});

it("sends a message to an agent and moves it to the top", () => {
  const { result } = renderHook(() =>
    useChatPage(
      directory({
        participants: [
          participant("a", { lastActivityAt: "2026-11-01T00:00:00.000Z" }),
          participant("b", { lastActivityAt: "2026-11-02T00:00:00.000Z" }),
        ],
      }),
    ),
  );
  expect(result.current.selection?.id).toBe("b");
  act(() => result.current.select({ kind: "participant", id: "a" }));

  act(() => result.current.send("Hello agent"));

  const [entries] = submissions("send");
  expect(entries).toMatchObject({
    intent: "send",
    text: "Hello agent",
    agentId: "a",
  });
  expect(entries?.["clientMessageId"]).toMatch(/^[0-9a-f-]{36}$/);
  expect(entries).not.toHaveProperty("participantId");
  expect(submit.mock.calls[0]?.[1]).toEqual({ method: "post" });
  expect(result.current.allParticipants.map((entry) => entry.id)).toEqual([
    "a",
    "b",
  ]);
});

it("sends a message to a person as a direct message", () => {
  const { result } = renderHook(() =>
    useChatPage(
      directory({ participants: [participant("p", { kind: "human" })] }),
    ),
  );

  act(() => result.current.send("Hi Paula"));

  expect(submissions("send-direct")).toEqual([
    expect.objectContaining({ participantId: "p", text: "Hi Paula" }),
  ]);
  expect(submissions("send-direct")[0]).not.toHaveProperty("agentId");
});

it("sends a message to the opened group", () => {
  const { result } = renderHook(() =>
    useChatPage(directory({ groups: [group("g")] })),
  );

  act(() => result.current.send("Hi all"));

  expect(submissions("send-group")).toEqual([
    expect.objectContaining({ groupId: "g", text: "Hi all" }),
  ]);
});

it("sends nothing for a blank text, without an opened entry or to a participant that cannot chat", () => {
  const empty = renderHook(() => useChatPage(directory()));
  act(() => empty.result.current.send("Hello"));

  const blank = renderHook(() =>
    useChatPage(directory({ participants: [participant("a")] })),
  );
  act(() => blank.result.current.send("   "));

  const unavailable = renderHook(() =>
    useChatPage(
      directory({ participants: [participant("a", { canChat: false })] }),
    ),
  );
  act(() => unavailable.result.current.send("Hello"));

  expect(submit).not.toHaveBeenCalled();
});

it("shows the message on its way after the opened conversation's own submission", () => {
  const formData = new FormData();
  formData.set("text", "On its way");
  formData.set("agentId", "a");
  fetcher.formData = formData;
  fetcher.state = "submitting";
  const history = [message("m1")];

  const { result } = renderHook(() =>
    useChatPage(
      directory({
        participants: [participant("a")],
        histories: { a: history },
      }),
    ),
  );

  expect(result.current.messages).toEqual([
    ...history,
    { id: "pending", authorId: null, content: "On its way", toolUses: [] },
  ]);
  expect(result.current.isAnswering).toBe(true);
  expect(result.current.answeringNames).toEqual(["Name a"]);
});

it("ignores a submission for another conversation or without text", () => {
  const other = new FormData();
  other.set("text", "Elsewhere");
  other.set("participantId", "someone-else");
  fetcher.formData = other;
  const { result, rerender } = renderHook(() =>
    useChatPage(directory({ participants: [participant("a")] })),
  );
  expect(result.current.messages).toEqual([]);
  expect(result.current.isAnswering).toBe(false);

  const stopForm = new FormData();
  stopForm.set("agentId", "a");
  fetcher.formData = stopForm;
  rerender();
  expect(result.current.messages).toEqual([]);

  const groupForm = new FormData();
  groupForm.set("text", "To group");
  groupForm.set("groupId", "a");
  fetcher.formData = groupForm;
  rerender();
  expect(result.current.messages).toHaveLength(1);
});

it("reports why the last message could not be sent once the sender is idle", () => {
  fetcher.data = { ok: false, error: "busy" };
  const { result, rerender } = renderHook(() =>
    useChatPage(directory({ participants: [participant("a")] })),
  );
  expect(result.current.sendFailure).toBe("busy");

  fetcher.data = { ok: false };
  rerender();
  expect(result.current.sendFailure).toBe("invalidInput");

  fetcher.data = { ok: true };
  rerender();
  expect(result.current.sendFailure).toBeNull();

  fetcher.data = { ok: false, error: "tooLong" };
  fetcher.state = "submitting";
  rerender();
  expect(result.current.sendFailure).toBeNull();

  fetcher.state = "idle";
  fetcher.data = "not a result";
  rerender();
  expect(result.current.sendFailure).toBeNull();

  fetcher.data = null;
  rerender();
  expect(result.current.sendFailure).toBeNull();
});

it("shows the agents of the opened group that answer now", () => {
  const { result } = renderHook(() =>
    useChatPage(
      directory({
        groups: [group("busy", { workingAgentNames: ["Ada", "Linus"] })],
      }),
    ),
  );

  expect(result.current.isAnswering).toBe(true);
  expect(result.current.answeringNames).toEqual(["Ada", "Linus"]);
});

it("does not answer in a group without working agents", () => {
  const { result } = renderHook(() =>
    useChatPage(directory({ groups: [group("quiet")] })),
  );

  expect(result.current.isAnswering).toBe(false);
  expect(result.current.answeringNames).toEqual([]);
});

it("answers while the opened agent works, but never for a person", () => {
  const working = renderHook(() =>
    useChatPage(
      directory({ participants: [participant("a", { status: "working" })] }),
    ),
  );
  expect(working.result.current.isAnswering).toBe(true);

  const person = renderHook(() =>
    useChatPage(
      directory({
        participants: [participant("p", { kind: "human", status: "working" })],
      }),
    ),
  );
  expect(person.result.current.isAnswering).toBe(false);
});

it("reads the history again every three seconds while an agent answers", () => {
  vi.useFakeTimers();
  const { unmount } = renderHook(() =>
    useChatPage(
      directory({ participants: [participant("a", { status: "working" })] }),
    ),
  );

  vi.advanceTimersByTime(2_999);
  expect(revalidate).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(revalidate).toHaveBeenCalledTimes(1);

  revalidator.state = "loading";
  vi.advanceTimersByTime(3_000);
  expect(revalidate).toHaveBeenCalledTimes(1);

  unmount();
  revalidator.state = "idle";
  vi.advanceTimersByTime(9_000);
  expect(revalidate).toHaveBeenCalledTimes(1);
});

it("does not poll while nobody answers", () => {
  vi.useFakeTimers();
  renderHook(() =>
    useChatPage(directory({ participants: [participant("a")] })),
  );

  vi.advanceTimersByTime(10_000);

  expect(revalidate).not.toHaveBeenCalled();
});

it("stops the opened agent", () => {
  const { result } = renderHook(() =>
    useChatPage(directory({ participants: [participant("a")] })),
  );

  act(() => result.current.stop());

  expect(submissions("stop")).toEqual([{ intent: "stop", agentId: "a" }]);
});

it("stops nothing when a group or nothing is open", () => {
  const inGroup = renderHook(() =>
    useChatPage(directory({ groups: [group("g")] })),
  );
  act(() => inGroup.result.current.stop());
  const nothing = renderHook(() => useChatPage(directory()));
  act(() => nothing.result.current.stop());

  expect(submit).not.toHaveBeenCalled();
});

it("adds a member to a group", () => {
  const { result } = renderHook(() =>
    useChatPage(directory({ groups: [group("g")] })),
  );

  act(() => result.current.addMember("g", "p"));

  expect(submissions("add-member")).toEqual([
    { intent: "add-member", groupId: "g", participantId: "p" },
  ]);
});

it("toggles the mute of an opened stored conversation", () => {
  const { result } = renderHook(() =>
    useChatPage(
      directory({
        participants: [
          participant("p", {
            kind: "human",
            conversationId: "conversation-p",
            isMuted: true,
          }),
        ],
      }),
    ),
  );
  expect(result.current.isMuted).toBe(true);

  act(() => result.current.toggleMute());

  expect(submissions("mute")).toEqual([
    { intent: "mute", conversationId: "conversation-p", isMuted: "false" },
  ]);
});

it("mutes an opened group and shows the requested state at once", () => {
  const { result, rerender } = renderHook(() =>
    useChatPage(directory({ groups: [group("g")] })),
  );
  expect(result.current.isMuted).toBe(false);

  act(() => result.current.toggleMute());
  expect(submissions("mute")).toEqual([
    { intent: "mute", conversationId: "g", isMuted: "true" },
  ]);

  const requested = new FormData();
  requested.set("conversationId", "g");
  requested.set("isMuted", "true");
  fetcher.formData = requested;
  rerender();
  expect(result.current.isMuted).toBe(true);

  requested.set("conversationId", "other");
  rerender();
  expect(result.current.isMuted).toBe(false);
});

it("has nothing to mute for an agent or a direct conversation not yet stored", () => {
  const agent = renderHook(() =>
    useChatPage(directory({ participants: [participant("a")] })),
  );
  expect(agent.result.current.isMuted).toBeNull();
  act(() => agent.result.current.toggleMute());

  const person = renderHook(() =>
    useChatPage(
      directory({
        participants: [
          participant("p", { kind: "human", conversationId: null }),
        ],
      }),
    ),
  );
  expect(person.result.current.isMuted).toBeNull();
  act(() => person.result.current.toggleMute());

  expect(submissions("mute")).toEqual([]);
});

it("offers to load older messages of a stored conversation and asks for the page before the oldest", () => {
  const { result } = renderHook(() =>
    useChatPage(
      directory({
        participants: [
          participant("p", { kind: "human", conversationId: "conversation-p" }),
        ],
        histories: { p: [message("m5"), message("m6")] },
        olderHistoryIds: ["p"],
      }),
    ),
  );
  expect(result.current.hasOlder).toBe(true);
  expect(result.current.isLoadingOlder).toBe(false);

  act(() => result.current.loadOlder());

  expect(submissions("history")).toEqual([
    { intent: "history", conversationId: "conversation-p", beforeId: "m5" },
  ]);
});

it("offers no older messages when the server holds none or for an agent", () => {
  const complete = renderHook(() =>
    useChatPage(
      directory({
        participants: [
          participant("p", { kind: "human", conversationId: "conversation-p" }),
        ],
        histories: { p: [message("m1")] },
      }),
    ),
  );
  expect(complete.result.current.hasOlder).toBe(false);
  act(() => complete.result.current.loadOlder());

  const agent = renderHook(() =>
    useChatPage(
      directory({
        participants: [participant("a")],
        histories: { a: [message("m1")] },
        olderHistoryIds: ["a"],
      }),
    ),
  );
  expect(agent.result.current.hasOlder).toBe(false);

  expect(submissions("history")).toEqual([]);
});

it("marks an opened stored conversation with unread messages read up to its newest message", () => {
  renderHook(() =>
    useChatPage(
      directory({
        groups: [group("g", { unreadCount: 2 })],
        histories: { g: [message("m1"), message("m2")] },
      }),
    ),
  );

  expect(submissions("read")).toEqual([
    { intent: "read", conversationId: "g", upToMessageId: "m2" },
  ]);
});
