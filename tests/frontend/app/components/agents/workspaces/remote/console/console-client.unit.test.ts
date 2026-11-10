import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONSOLE_INPUT_FRAGMENT } from "@/definition/RemoteConsole";

import {
  ENDPOINT,
  FakeWebSocket,
  SESSION_ID,
  answer,
  createHarness,
  installConsoleGlobals,
  latestChannel,
  postedBodies,
  restoreConsoleGlobals,
  startConnected,
  state,
  stateEvent,
} from "./console-client-fixture";

beforeEach(installConsoleGlobals);
afterEach(restoreConsoleGlobals);

describe("start", () => {
  it("opens a session with the measured geometry and follows its channel from the beginning", async () => {
    const harness = createHarness();

    await harness.client.start();

    expect(harness.fetchMock).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({ method: "POST" }),
    );
    expect(postedBodies(harness.fetchMock)).toEqual([
      { intent: "open", columns: 100, rows: 30 },
    ]);
    const url = new URL(latestChannel().url);
    expect(url.protocol).toBe("ws:");
    expect(url.pathname).toBe(`${ENDPOINT}/socket`);
    expect(url.searchParams.get("sessionId")).toBe(SESSION_ID);
    expect(url.searchParams.get("after")).toBe("0");
  });

  it("uses a secure channel for a secure page address", async () => {
    const harness = createHarness("https://pages.example/console");

    await harness.client.start();

    expect(latestChannel().url).toMatch(
      /^wss:\/\/pages\.example\/console\/socket\?/u,
    );
  });

  it("blocks with the classified message of a refused open request", async () => {
    const harness = createHarness(ENDPOINT, [
      () =>
        Promise.resolve(
          answer({ message: "remote.error.remote_access_denied" }, false),
        ),
    ]);

    await harness.client.start();

    expect(harness.terminal.options.disableStdin).toBe(true);
    expect(harness.states).toEqual([
      state({
        status: "blocked",
        message: "remote.error.remote_access_denied",
      }),
    ]);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("reports an unclassified refusal as a generic remote failure", async () => {
    const harness = createHarness(ENDPOINT, [
      () => Promise.resolve(answer({ message: "stack trace" }, false)),
    ]);

    await harness.client.start();

    expect(harness.states.at(-1)).toEqual(
      state({ status: "blocked", message: "remote.failure.remote_failed" }),
    );
  });

  it("reports a network failure and an unusable session answer as a generic failure", async () => {
    const offline = createHarness(ENDPOINT, [
      () => Promise.reject(new TypeError("fetch failed")),
    ]);
    await offline.client.start();
    expect(offline.states.at(-1)?.message).toBe("remote.failure.remote_failed");

    const malformed = createHarness(ENDPOINT, [
      () => Promise.resolve(answer({ sessionId: "not-a-uuid" })),
    ]);
    await malformed.client.start();
    expect(malformed.states.at(-1)?.message).toBe(
      "remote.failure.remote_failed",
    );
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("reports a rejection that is no error as a generic failure", async () => {
    const harness = createHarness();
    harness.fetchMock.mockRejectedValueOnce("offline");

    await harness.client.start();

    expect(harness.states.at(-1)).toEqual(
      state({ status: "blocked", message: "remote.failure.remote_failed" }),
    );
  });

  it("releases a session that was allocated after the panel was disposed", async () => {
    let finishOpening: (response: Response) => void = () => undefined;
    const harness = createHarness(ENDPOINT, [
      () =>
        new Promise<Response>((resolve) => {
          finishOpening = resolve;
        }),
    ]);

    const starting = harness.client.start();
    harness.client.dispose();
    finishOpening(answer({ sessionId: SESSION_ID }));
    await starting;

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(postedBodies(harness.fetchMock)).toEqual([
      { intent: "open", columns: 100, rows: 30 },
      { intent: "close", sessionId: SESSION_ID },
    ]);
    expect(harness.states).toEqual([]);
  });
});

describe("receiving events", () => {
  it("writes new output once and ignores output that was replayed", async () => {
    const harness = createHarness();
    const channel = await startConnected(harness);

    channel.emit({ kind: "output", sequence: 2, chunk: "hello" });
    channel.emit({ kind: "output", sequence: 2, chunk: "again" });
    channel.emit({ kind: "output", sequence: 1, chunk: "older" });
    channel.emit({ kind: "output", sequence: 3, chunk: " world" });

    expect(harness.terminal.written).toEqual(["hello", " world"]);
  });

  it("reports a gap of the bounded history without writing anything", async () => {
    const harness = createHarness();
    const channel = await startConnected(harness);

    channel.emit({ kind: "gap", sequence: 7 });

    expect(harness.onGap).toHaveBeenCalledTimes(1);
    expect(harness.terminal.written).toEqual([]);
  });

  it("unlocks input and sends the geometry when the shell connects, and locks it again otherwise", async () => {
    const harness = createHarness();
    harness.terminal.cols = 120;
    harness.terminal.rows = 40;
    const channel = await startConnected(harness);

    expect(harness.terminal.options.disableStdin).toBe(false);
    expect(harness.states).toEqual([state({ status: "connected" })]);
    expect(channel.commands()).toEqual([
      { type: "resize", columns: 120, rows: 40 },
    ]);

    channel.emit(stateEvent(2, { status: "reconnecting", attempts: 1 }));

    expect(harness.terminal.options.disableStdin).toBe(true);
    expect(harness.states.at(-1)?.status).toBe("reconnecting");
    expect(channel.commands()).toHaveLength(1);
  });

  it("blocks and closes the channel on a message it cannot understand", async () => {
    const harness = createHarness();
    const channel = await startConnected(harness);

    channel.onmessage?.({ data: "{broken" });

    expect(channel.close).toHaveBeenCalledTimes(1);
    expect(harness.terminal.options.disableStdin).toBe(true);
    expect(harness.states.at(-1)).toEqual(
      state({
        status: "blocked",
        message: "remote.failure.remote_failed",
      }),
    );
  });

  it("blocks on an event of an unknown kind", async () => {
    const harness = createHarness();
    const channel = await startConnected(harness);

    channel.onmessage?.({
      data: JSON.stringify({ kind: "surprise", sequence: 9 }),
    });

    expect(harness.states.at(-1)?.status).toBe("blocked");
  });

  it("continues after the last received event when the channel is attached again", async () => {
    const harness = createHarness();
    const channel = await startConnected(harness);
    channel.emit({ kind: "output", sequence: 5, chunk: "x" });

    harness.client.reconnect();

    const url = new URL(latestChannel().url);
    expect(url.searchParams.get("after")).toBe("5");
  });
});

describe("input", () => {
  it("sends typing as an input command bound to the shell attempt", async () => {
    const harness = createHarness();
    const channel = await startConnected(harness);
    channel.emit(stateEvent(2, { status: "connected", attempts: 2 }));

    harness.client.input("ls\n");

    expect(channel.commands().at(-1)).toEqual({
      type: "input",
      attempt: 2,
      data: "ls\n",
    });
  });

  it("splits a long paste into ordered fragments", async () => {
    const harness = createHarness();
    const channel = await startConnected(harness);
    const paste = "a".repeat(CONSOLE_INPUT_FRAGMENT) + "b".repeat(10);

    harness.client.input(paste);

    expect(channel.commands().slice(1)).toEqual([
      {
        type: "input",
        attempt: 0,
        data: "a".repeat(CONSOLE_INPUT_FRAGMENT),
      },
      { type: "input", attempt: 0, data: "b".repeat(10) },
    ]);
  });

  it("drops input while the shell is not connected or the channel is not open", async () => {
    const harness = createHarness();
    await harness.client.start();
    const channel = latestChannel();

    harness.client.input("early");
    channel.open();
    channel.emit(stateEvent(1, { status: "connecting" }));
    harness.client.input("still connecting");
    channel.emit(stateEvent(2, { status: "connected" }));
    channel.readyState = 0;
    harness.client.input("channel not open");

    expect(
      channel.commands().filter((command) => {
        return (command as { type: string }).type === "input";
      }),
    ).toEqual([]);
  });

  it("refuses to hold more than a quarter megabyte of unsent input", async () => {
    const harness = createHarness();
    const channel = await startConnected(harness);
    channel.bufferedAmount = 256 * 1024 - 2;

    harness.client.input("abc");

    expect(channel.commands()).toHaveLength(1);
    expect(harness.terminal.options.disableStdin).toBe(true);
    expect(harness.states.at(-1)).toEqual(
      state({ status: "blocked", message: "remote.console.inputOverflow" }),
    );
  });
});

describe("resize", () => {
  it("forwards the current geometry only through an open channel", async () => {
    const harness = createHarness();
    harness.client.resize();
    await harness.client.start();
    const channel = latestChannel();
    harness.client.resize();
    channel.open();
    harness.terminal.cols = 90;
    harness.terminal.rows = 25;

    harness.client.resize();

    expect(channel.commands()).toEqual([
      { type: "resize", columns: 90, rows: 25 },
    ]);
  });
});

describe("acknowledging output", () => {
  it("reports processed output after a short quiet time, in one message", async () => {
    const harness = createHarness();
    const channel = await startConnected(harness);
    channel.emit({ kind: "output", sequence: 2, chunk: "abc" });
    channel.emit({ kind: "output", sequence: 3, chunk: "de" });

    harness.terminal.parsed.forEach((parsed) => parsed());
    expect(channel.commands()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(channel.commands()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(channel.commands().at(-1)).toEqual({ type: "ack", characters: 5 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(channel.commands()).toHaveLength(2);
  });

  it("reports at once when a large amount has been processed", async () => {
    const harness = createHarness();
    const channel = await startConnected(harness);
    channel.emit({ kind: "output", sequence: 2, chunk: "x".repeat(16 * 1024) });

    harness.terminal.parsed[0]?.();

    expect(channel.commands().at(-1)).toEqual({
      type: "ack",
      characters: 16 * 1024,
    });
  });

  it("does not report output that a lost channel will replay", async () => {
    const harness = createHarness();
    const channel = await startConnected(harness);
    channel.emit({ kind: "output", sequence: 2, chunk: "abc" });
    harness.terminal.parsed[0]?.();

    channel.drop();
    await vi.advanceTimersByTimeAsync(200);

    expect(channel.commands()).toHaveLength(1);
  });
});
