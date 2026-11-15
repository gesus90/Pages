import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  readLivePayload,
  useConversationStream,
} from "@/app/components/chat-page/live/use-conversation-stream";

const revalidate = vi.hoisted(() => vi.fn());
vi.mock("react-router", () => ({
  useRevalidator: () => ({ state: "idle", revalidate }),
}));

/** A socket the test drives: it opens, receives frames and closes on request. */
class FakeSocket extends EventTarget {
  public readonly url: string;
  public readonly sent: string[] = [];
  public isClosed = false;

  public constructor(url: string) {
    super();
    this.url = url;
  }

  /** Records an outgoing frame sent over the fake socket. */
  public send(frame: string): void {
    this.sent.push(frame);
  }

  /** Marks the fake socket as closed. */
  public close(): void {
    this.isClosed = true;
  }

  /** Dispatches an open event on the fake socket. */
  public open(): void {
    this.dispatchEvent(new Event("open"));
  }

  /** Dispatches a message event containing the serialized frame. */
  public receive(frame: unknown): void {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(frame) }),
    );
  }

  /** Dispatches a close event on the fake socket. */
  public drop(): void {
    this.dispatchEvent(new Event("close"));
  }
}

const CONNECTED = { version: 1, requestId: "web-auth", type: "connected" };

function textFrame(seq: number, delta: string): unknown {
  return {
    version: 1,
    requestId: null,
    type: "conversation_event",
    payload: {
      type: "answer_text",
      data: {
        chatKind: "agent",
        chatId: "ed",
        agentId: "ed",
        answerId: "a1",
        seq,
        at: "2026-11-14T10:00:00.000Z",
        delta,
        isReset: false,
      },
    },
  };
}

function setup(): {
  readonly sockets: FakeSocket[];
  readonly result: {
    readonly current: ReturnType<typeof useConversationStream>;
  };
  readonly unmount: () => void;
} {
  const sockets: FakeSocket[] = [];
  const { result, unmount } = renderHook(() =>
    useConversationStream({
      createSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    }),
  );
  return { sockets, result, unmount };
}

beforeEach(() => {
  vi.useFakeTimers();
  revalidate.mockReset();
});
afterEach(() => vi.useRealTimers());

it("connects to conversations.v1 on the Pages port and signs in with the page's session", () => {
  const { sockets } = setup();
  const [socket] = sockets;
  expect(socket?.url).toBe(
    `ws://${window.location.host}/chat/conversations/socket`,
  );
  act(() => socket?.open());
  expect(JSON.parse(socket?.sent[0] ?? "{}")).toEqual({
    version: 1,
    type: "auth",
    requestId: "web-auth",
    payload: { method: "session", token: "cookie" },
  });
});

it("shows the parts of an answer as they arrive and reads the page once at its end", async () => {
  const { sockets, result } = setup();
  const socket = sockets[0];
  act(() => {
    socket?.open();
    socket?.receive(CONNECTED);
    socket?.receive(textFrame(1, "Hallo "));
    socket?.receive(textFrame(2, "Igor"));
    socket?.receive(textFrame(2, "Igor"));
  });
  expect(result.current.isConnected).toBe(true);
  expect(result.current.state.answers["a1"]?.text).toBe("Hallo Igor");
  expect(revalidate).not.toHaveBeenCalled();
  act(() => {
    socket?.receive({
      type: "conversation_event",
      payload: {
        type: "answer_end",
        data: {
          chatKind: "agent",
          chatId: "ed",
          agentId: "ed",
          answerId: "a1",
          seq: 3,
          at: "2026-11-14T10:00:01.000Z",
          messageId: "m1",
          state: "answered",
        },
      },
    });
    vi.advanceTimersByTime(200);
  });
  expect(revalidate).toHaveBeenCalledOnce();
  // No reading at fixed intervals afterwards.
  await act(() => vi.advanceTimersByTime(60_000));
  expect(revalidate).toHaveBeenCalledOnce();
});

it("connects again after a lost connection and reads the state of the page once", async () => {
  const { sockets, result } = setup();
  act(() => {
    sockets[0]?.open();
    sockets[0]?.receive(CONNECTED);
  });
  expect(revalidate).not.toHaveBeenCalled();
  act(() => sockets[0]?.drop());
  expect(result.current.isConnected).toBe(false);
  await act(() => vi.advanceTimersByTime(999));
  expect(sockets).toHaveLength(1);
  await act(() => vi.advanceTimersByTime(1));
  expect(sockets).toHaveLength(2);
  act(() => {
    sockets[1]?.open();
    sockets[1]?.receive(CONNECTED);
    vi.advanceTimersByTime(200);
  });
  expect(result.current.isConnected).toBe(true);
  expect(revalidate).toHaveBeenCalledOnce();
});

it("waits longer after every failed attempt and closes the channel with the page", async () => {
  const { sockets, unmount } = setup();
  act(() => sockets[0]?.drop());
  await act(() => vi.advanceTimersByTime(1_000));
  act(() => sockets[1]?.drop());
  await act(() => vi.advanceTimersByTime(1_999));
  expect(sockets).toHaveLength(2);
  await act(() => vi.advanceTimersByTime(1));
  expect(sockets).toHaveLength(3);
  unmount();
  expect(sockets[2]?.isClosed).toBe(true);
  await act(() => vi.advanceTimersByTime(60_000));
  expect(sockets).toHaveLength(3);
});

it("ignores every frame that is no part of a live answer", () => {
  expect(
    readLivePayload({
      type: "conversation_event",
      payload: { type: "message", data: {} },
    }),
  ).toBeNull();
  expect(readLivePayload({ type: "error" })).toBeNull();
  expect(readLivePayload(null)).toBeNull();
  expect(
    readLivePayload({
      type: "conversation_event",
      payload: { type: "answer_text", data: { answerId: 1 } },
    }),
  ).toBeNull();
});
