import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { useChatPage } from "@/app/components/chat-page/use-chat-page";

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

it("opens the notification's requested chat initially without marking the default chat read", () => {
  const { result } = renderHook(() =>
    useChatPage(
      directory({
        participants: [
          participant("target", { conversationId: "direct", unreadCount: 1 }),
        ],
        groups: [group("default", { unreadCount: 1 })],
        histories: { default: [message("wrong")], target: [message("right")] },
      }),
      { kind: "participant", id: "target" },
    ),
  );
  expect(result.current.selection).toEqual({
    kind: "participant",
    id: "target",
  });
  expect(submissions("read").map((form) => form["conversationId"])).toEqual([
    "direct",
  ]);
});

it("sends a message during an answer into it or after it, as the person chose (PAGE-381)", () => {
  const { result } = renderHook(() =>
    useChatPage(
      directory({ participants: [participant("ed", { status: "working" })] }),
    ),
  );
  act(() => result.current.send("Nimm B", [], "steer"));
  act(() => result.current.send("Danach C", [], "after"));
  const [steer, after] = submissions("send");
  expect(steer).toMatchObject({
    text: "Nimm B",
    delivery: "steer",
    agentId: "ed",
  });
  expect(after).toMatchObject({ text: "Danach C", delivery: "after" });
});

it("sends a plain message while nobody answers, whatever was asked (PAGE-381)", () => {
  const { result } = renderHook(() =>
    useChatPage(directory({ participants: [participant("ed")] })),
  );
  act(() => result.current.send("Hallo", [], "steer"));
  expect(submissions("send")[0]?.["delivery"]).toBeUndefined();
});

it("shows a message steered in or sent after the answer at once (PAGE-381)", () => {
  const formData = new FormData();
  formData.set("intent", "send");
  formData.set("agentId", "ed");
  formData.set("text", "Nimm B");
  formData.set("delivery", "steer");
  formData.set("steeredInto", "ed");
  fetcher.formData = formData;
  const { result } = renderHook(() =>
    useChatPage(
      directory({ participants: [participant("ed", { status: "working" })] }),
    ),
  );
  expect(result.current.messages.at(-1)).toMatchObject({
    id: "pending",
    steeredInto: ["ed"],
  });
  formData.set("delivery", "after");
  const later = renderHook(() =>
    useChatPage(
      directory({ participants: [participant("ed", { status: "working" })] }),
    ),
  );
  expect(later.result.current.messages.at(-1)).toMatchObject({ queue: "chat" });
});

it("stops every answering agent of a group at once and names what each does (PAGE-381)", () => {
  const { result } = renderHook(() =>
    useChatPage(
      directory({
        participants: [
          participant("ed", { name: "Ed" }),
          participant("mei", { name: "Mei" }),
        ],
        groups: [
          group("team", {
            memberIds: ["ed", "mei"],
            workingAgents: [
              { id: "ed", name: "Ed" },
              { id: "mei", name: "Mei" },
            ],
            workingAgentNames: ["Ed", "Mei"],
          }),
        ],
      }),
    ),
  );
  expect(result.current.isAnswering).toBe(true);
  expect(result.current.activity.map((entry) => entry.agent.name)).toEqual([
    "Ed",
    "Mei",
  ]);
  act(() => result.current.stopAll());
  expect(
    submissions("stop-group").map((entries) => entries["agentId"]),
  ).toEqual(["ed", "mei"]);
});
