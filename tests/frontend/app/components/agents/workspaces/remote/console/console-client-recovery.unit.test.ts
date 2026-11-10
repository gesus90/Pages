import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONSOLE_MAXIMUM_RETRIES } from "@/definition/RemoteConsole";

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

import type { Harness } from "./console-client-fixture";

beforeEach(installConsoleGlobals);
afterEach(restoreConsoleGlobals);

describe("a lost channel", () => {
  it("reconnects an established channel after a pause and counts the attempt", async () => {
    const harness = createHarness();
    const channel = await startConnected(harness);

    channel.drop();

    expect(harness.terminal.options.disableStdin).toBe(true);
    expect(harness.states.at(-1)).toEqual(
      state({
        status: "reconnecting",
        attempts: 1,
        message: "remote.console.streamLost",
      }),
    );
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("starts counting anew once a channel opened again", async () => {
    const harness = createHarness();
    const first = await startConnected(harness);
    first.drop();
    await vi.advanceTimersByTimeAsync(3000);
    latestChannel().open();
    latestChannel().drop();

    expect(harness.states.at(-1)?.attempts).toBe(1);
  });

  it("stops for good when the server replaced or refused the channel", async () => {
    for (const code of [4001, 4003]) {
      const harness = createHarness();
      const channel = await startConnected(harness);
      const channelCount = FakeWebSocket.instances.length;

      channel.drop(code);

      expect(harness.states.at(-1)).toEqual(
        state({ status: "blocked", message: "remote.console.streamBlocked" }),
      );
      await vi.advanceTimersByTimeAsync(10_000);
      expect(FakeWebSocket.instances).toHaveLength(channelCount);
    }
  });

  it("ignores the close of a channel that was replaced and of an ended shell", async () => {
    const harness = createHarness();
    const channel = await startConnected(harness);
    harness.client.reconnect();
    const statesBefore = harness.states.length;
    channel.drop();
    expect(harness.states).toHaveLength(statesBefore);

    const replacement = latestChannel();
    replacement.open();
    replacement.emit(stateEvent(2, { status: "ended", exitCode: 0 }));
    replacement.drop();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(harness.states.at(-1)?.status).toBe("ended");
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("does not retry after the shell ended even if a close raced the end", async () => {
    const harness = createHarness();
    const channel = await startConnected(harness);
    channel.emit(stateEvent(2, { status: "ended", exitCode: 0 }));
    harness.client.reconnect();
    FakeWebSocket.instances.at(-1)?.open();
    const last = latestChannel();
    last.drop();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(harness.states.at(-1)?.status).toBe("ended");
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});

async function refusedChannel(
  responses: readonly (() => Promise<Response>)[],
): Promise<Harness> {
  const harness = createHarness(ENDPOINT, [
    () => Promise.resolve(answer({ sessionId: SESSION_ID })),
    ...responses,
  ]);
  await harness.client.start();
  latestChannel().drop();
  await vi.advanceTimersByTimeAsync(0);
  return harness;
}

describe("a refused channel", () => {
  it("asks the route and retries the stream when the shell still exists", async () => {
    const harness = await refusedChannel([
      () => Promise.resolve(answer({ ok: true })),
    ]);

    expect(postedBodies(harness.fetchMock).at(-1)).toEqual({
      intent: "reconnect",
      sessionId: SESSION_ID,
    });
    expect(harness.states.at(-1)?.status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(3000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("reports a vanished shell as lost instead of retrying", async () => {
    const harness = await refusedChannel([
      () =>
        Promise.resolve(
          answer({ message: "remote.error.remote_workspace_not_found" }, false),
        ),
    ]);

    expect(harness.states.at(-1)).toEqual(
      state({ status: "blocked", message: "remote.console.sessionLost" }),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("shows the classified reason the route names", async () => {
    const harness = await refusedChannel([
      () =>
        Promise.resolve(
          answer({ message: "remote.failure.host_key_changed" }, false),
        ),
    ]);

    expect(harness.states.at(-1)?.message).toBe(
      "remote.failure.host_key_changed",
    );
    expect(harness.states.at(-1)?.status).toBe("blocked");
  });

  it("retries when the route rejects with something that is no error", async () => {
    const harness = await refusedChannel([() => Promise.reject("offline")]);

    expect(harness.states.at(-1)?.status).toBe("reconnecting");
    expect(harness.states.at(-1)?.attempts).toBe(1);
  });

  it("retries when the route itself cannot be reached", async () => {
    const harness = await refusedChannel([
      () => Promise.reject(new TypeError("fetch failed")),
    ]);

    expect(harness.states.at(-1)).toEqual(
      state({
        status: "reconnecting",
        attempts: 1,
        message: "remote.console.streamLost",
      }),
    );
  });
});

describe("a channel that never opens", () => {
  it("stays silent when the panel was disposed while asking", async () => {
    let answerProbe: (error: Error) => void = () => undefined;
    const harness = createHarness(ENDPOINT, [
      () => Promise.resolve(answer({ sessionId: SESSION_ID })),
      () =>
        new Promise<Response>((resolve, reject) => {
          answerProbe = reject;
        }),
    ]);
    await harness.client.start();
    latestChannel().drop();
    harness.client.dispose();
    answerProbe(new Error("remote.error.remote_access_denied"));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(harness.states).toEqual([]);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("gives up with a blocked console after the bounded number of attempts", async () => {
    const harness = createHarness(ENDPOINT, [
      () => Promise.resolve(answer({ sessionId: SESSION_ID })),
    ]);
    await harness.client.start();

    for (let attempt = 1; attempt <= CONSOLE_MAXIMUM_RETRIES; attempt += 1) {
      latestChannel().drop();
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.states.at(-1)?.attempts).toBe(attempt);
      expect(harness.states.at(-1)?.status).toBe("reconnecting");
      await vi.advanceTimersByTimeAsync(3000);
    }
    latestChannel().drop();
    await vi.advanceTimersByTimeAsync(0);

    expect(harness.states.at(-1)).toEqual(
      state({
        status: "blocked",
        attempts: CONSOLE_MAXIMUM_RETRIES,
        message: "remote.console.streamBlocked",
      }),
    );
    const channelCount = FakeWebSocket.instances.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeWebSocket.instances).toHaveLength(channelCount);
  });
});

describe("reconnect", () => {
  it("starts a session when none was allocated yet", async () => {
    const harness = createHarness(ENDPOINT, [
      () =>
        Promise.resolve(
          answer({ message: "remote.failure.remote_failed" }, false),
        ),
    ]);
    await harness.client.start();
    expect(harness.states.at(-1)?.status).toBe("blocked");

    harness.client.reconnect();
    await vi.advanceTimersByTimeAsync(0);

    expect(postedBodies(harness.fetchMock)).toHaveLength(2);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("attaches a new channel at once and drops the retry that was pending", async () => {
    const harness = createHarness();
    const channel = await startConnected(harness);
    channel.drop();

    harness.client.reconnect();

    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("asks the server to reconnect a blocked shell and shows a refusal", async () => {
    const harness = createHarness(ENDPOINT, [
      () => Promise.resolve(answer({ sessionId: SESSION_ID })),
      () =>
        Promise.resolve(
          answer({ message: "remote.error.remote_blocked" }, false),
        ),
    ]);
    const channel = await startConnected(harness);
    channel.emit(
      stateEvent(2, {
        status: "blocked",
        message: "remote.failure.transport_lost",
      }),
    );

    harness.client.reconnect();
    await vi.advanceTimersByTimeAsync(0);

    expect(channel.close).toHaveBeenCalledTimes(1);
    expect(postedBodies(harness.fetchMock).at(-1)).toEqual({
      intent: "reconnect",
      sessionId: SESSION_ID,
    });
    expect(harness.states.at(-1)).toEqual(
      state({
        status: "blocked",
        message: "remote.error.remote_blocked",
      }),
    );
  });

  it("does nothing once the series of retries is used up", async () => {
    const harness = createHarness();
    await harness.client.start();
    for (let attempt = 0; attempt < CONSOLE_MAXIMUM_RETRIES; attempt += 1) {
      latestChannel().drop();
      await vi.advanceTimersByTimeAsync(3000);
    }
    const channelCount = FakeWebSocket.instances.length;
    const fetchCount = harness.fetchMock.mock.calls.length;
    const latest = latestChannel();

    harness.client.reconnect();

    expect(FakeWebSocket.instances).toHaveLength(channelCount);
    expect(latest.close).not.toHaveBeenCalled();
    expect(harness.fetchMock.mock.calls).toHaveLength(fetchCount);
  });
});

describe("dispose", () => {
  it("closes the channel, cancels timers and releases the shell once", async () => {
    const harness = createHarness();
    const channel = await startConnected(harness);
    channel.emit({ kind: "output", sequence: 2, chunk: "abc" });
    harness.terminal.parsed[0]?.();

    harness.client.dispose();
    harness.client.dispose();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(channel.close).toHaveBeenCalledTimes(1);
    expect(channel.commands()).toHaveLength(1);
    const closeCalls = harness.fetchMock.mock.calls.filter(
      ([, init]) => JSON.parse(String(init.body)).intent === "close",
    );
    expect(closeCalls).toHaveLength(1);
    expect(closeCalls[0]?.[1]).toMatchObject({
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "close", sessionId: SESSION_ID }),
    });
  });

  it("cancels a pending channel retry", async () => {
    const harness = createHarness();
    const channel = await startConnected(harness);
    channel.drop();

    harness.client.dispose();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("ignores a failing release request and later failures", async () => {
    const harness = createHarness(ENDPOINT, [
      () => Promise.resolve(answer({ sessionId: SESSION_ID })),
      () => Promise.reject(new TypeError("offline")),
    ]);
    const channel = await startConnected(harness);
    const statesBefore = harness.states.length;

    harness.client.dispose();
    await vi.advanceTimersByTimeAsync(0);
    channel.onmessage?.({ data: "{broken" });

    expect(harness.states).toHaveLength(statesBefore);
  });

  it("releases nothing when no session was allocated", () => {
    const harness = createHarness();

    harness.client.dispose();

    expect(harness.fetchMock).not.toHaveBeenCalled();
  });
});
