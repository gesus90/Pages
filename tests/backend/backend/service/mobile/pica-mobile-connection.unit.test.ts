import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logEvent } from "@/backend/logging/Logger";
import { PicaMobileConnection } from "@/backend/service/mobile/PicaMobileConnection";

import {
  ANNA_OUTCOME,
  FakeAuthenticator,
  FakeChannel,
  clientMessage,
  sessionAuth,
} from "./pica-mobile-fixture";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

const HEARTBEAT_MILLISECONDS = 20_000;
const ANY_TEXT: unknown = expect.any(String);

interface Setup {
  readonly channel: FakeChannel;
  readonly authenticator: FakeAuthenticator;
  readonly connection: PicaMobileConnection;
}

function setup(): Setup {
  const channel = new FakeChannel();
  const authenticator = new FakeAuthenticator();
  const connection = new PicaMobileConnection(channel, {
    connectionId: "connection-1",
    origin: { clientAddress: "192.168.0.7", userAgent: "okhttp/4" },
    authenticator,
    serverVersion: "9.9.9",
  });

  connection.start();

  return { channel, authenticator, connection };
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

async function send(world: Setup, text: string): Promise<void> {
  world.connection.receiveText(text);
  await settle();
}

async function signIn(world: Setup): Promise<void> {
  await send(world, sessionAuth());
  world.channel.sent.length = 0;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T10:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("before authentication", () => {
  it("refuses every message but auth and says why", async () => {
    const world = setup();

    await send(world, clientMessage("ping", {}, "ping-1"));

    expect(world.channel.messages()).toEqual([
      {
        version: 1,
        type: "error",
        requestId: "ping-1",
        payload: {
          code: "authentication_required",
          message: ANY_TEXT,
        },
      },
    ]);
  });

  it("closes a connection that does not authenticate in time", async () => {
    const world = setup();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(world.channel.closes).toEqual([
      { code: 1008, reason: "Authentication timeout" },
    ]);
  });

  it("cuts off a peer that ignores the closing handshake", async () => {
    const world = setup();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(world.channel.terminateCount).toBe(0);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(world.channel.terminateCount).toBe(1);
  });
});

describe("authentication", () => {
  it("confirms a session sign-in with the account and the timing facts", async () => {
    const world = setup();

    await send(world, sessionAuth("auth-7"));

    expect(world.authenticator.authenticate).toHaveBeenCalledWith(
      { method: "session", token: "session-token-anna" },
      { clientAddress: "192.168.0.7", userAgent: "okhttp/4" },
    );
    expect(world.channel.messages()).toEqual([
      {
        version: 1,
        type: "connected",
        requestId: "auth-7",
        payload: {
          connectionId: "connection-1",
          user: ANNA_OUTCOME.user,
          sessionToken: null,
          heartbeat: { intervalMilliseconds: 20_000, timeoutMilliseconds: 45_000 },
          server: { version: "9.9.9", protocolVersions: [1] },
        },
      },
    ]);
  });

  it("hands the issued session token to a client that signed in with a password", async () => {
    const world = setup();

    world.authenticator.authenticate.mockResolvedValueOnce({
      ...ANNA_OUTCOME,
      sessionToken: "fresh-token",
      isSessionIssued: true,
    });
    await send(
      world,
      clientMessage("auth", {
        method: "password",
        username: "anna",
        password: "pw",
      }),
    );

    expect(world.channel.messages()[0].payload.sessionToken).toBe(
      "fresh-token",
    );
  });

  it("stops the authentication time limit once the client is connected", async () => {
    const world = setup();

    await send(world, sessionAuth());
    await vi.advanceTimersByTimeAsync(11_000);

    expect(world.channel.closes).toEqual([]);
  });

  it("answers a ping with a pong after the sign-in", async () => {
    const world = setup();

    await signIn(world);
    await send(world, clientMessage("ping", {}, "ping-2"));

    expect(world.channel.messages()).toEqual([
      {
        version: 1,
        type: "pong",
        requestId: "ping-2",
        payload: { serverTime: "2026-10-23T10:00:00.000Z" },
      },
    ]);
  });

  it("rejects a second authentication without asking again", async () => {
    const world = setup();

    await signIn(world);
    await send(world, sessionAuth("auth-2"));

    expect(world.channel.errorCodes()).toEqual(["already_authenticated"]);
    expect(world.authenticator.authenticate).toHaveBeenCalledTimes(1);
  });

});

describe("rejected authentication", () => {
  it.each([
    ["invalidCredentials", "authentication_failed"],
    ["passwordChangeRequired", "password_change_required"],
  ] as const)("maps %s to %s", async (reason, code) => {
    const world = setup();

    world.authenticator.authenticate.mockResolvedValueOnce({
      ok: false,
      reason,
    });
    await send(world, sessionAuth());

    expect(world.channel.errorCodes()).toEqual([code]);
    expect(world.channel.closes).toEqual([]);
  });

  it("tells a throttled client how long to wait", async () => {
    const world = setup();

    world.authenticator.authenticate.mockResolvedValueOnce({
      ok: false,
      reason: "tooManyAttempts",
      retryAfterSeconds: 30,
    });
    await send(world, sessionAuth("auth-3"));

    expect(world.channel.messages()[0]).toMatchObject({
      requestId: "auth-3",
      payload: { code: "too_many_attempts", retryAfterSeconds: 30 },
    });
  });

  it("closes the connection after three failed authentications", async () => {
    const world = setup();

    world.authenticator.authenticate.mockResolvedValue({
      ok: false,
      reason: "invalidCredentials",
    });
    await send(world, sessionAuth("a-1"));
    await send(world, sessionAuth("a-2"));
    expect(world.channel.closes).toEqual([]);
    await send(world, sessionAuth("a-3"));

    expect(world.channel.closes).toEqual([
      { code: 1008, reason: "Too many failed authentications" },
    ]);
  });

  it("reports an unavailable Pages instead of crashing", async () => {
    const world = setup();

    world.authenticator.authenticate.mockRejectedValueOnce(
      new Error("Pages is not set up yet"),
    );
    await send(world, sessionAuth("auth-9"));

    expect(world.channel.messages()).toEqual([
      {
        version: 1,
        type: "error",
        requestId: "auth-9",
        payload: { code: "server_unavailable", message: ANY_TEXT },
      },
    ]);
    await send(world, sessionAuth("auth-10"));
    expect(world.channel.messages()[1].type).toBe("connected");
  });

  it("drops the answer when the connection ended while Pages was deciding", async () => {
    const world = setup();
    let finish: (outcome: typeof ANNA_OUTCOME) => void = () => undefined;

    world.authenticator.authenticate.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    world.connection.receiveText(sessionAuth());
    await settle();
    world.connection.stop(1006);
    finish(ANNA_OUTCOME);
    await settle();

    expect(world.channel.sent).toEqual([]);
  });
});

describe("protocol violations", () => {
  it.each([
    ["malformed JSON", "{"],
    ["a wrong version", JSON.stringify({ version: 3, type: "ping" })],
    ["an unknown type", clientMessage("chat.send")],
  ])("answers %s with a structured error", async (_, text) => {
    const world = setup();

    await send(world, text);

    expect(world.channel.messages()).toHaveLength(1);
    expect(world.channel.messages()[0].type).toBe("error");
    expect(world.channel.closes).toEqual([]);
  });

  it("reports the supported versions for an unsupported one", async () => {
    const world = setup();

    await send(
      world,
      JSON.stringify({ version: 2, type: "ping", requestId: "x", payload: {} }),
    );

    expect(world.channel.messages()[0].payload).toMatchObject({
      code: "unsupported_version",
      supportedVersions: [1],
    });
  });

  it("closes after five rejections in a row", async () => {
    const world = setup();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await send(world, "garbage");
    }
    expect(world.channel.closes).toEqual([]);
    await send(world, "garbage");

    expect(world.channel.closes).toEqual([
      { code: 1008, reason: "Too many rejected messages" },
    ]);
  });

  it("counts only consecutive rejections", async () => {
    const world = setup();

    await signIn(world);
    for (let round = 0; round < 3; round += 1) {
      await send(world, "garbage");
      await send(world, "garbage");
      await send(world, "garbage");
      await send(world, clientMessage("ping"));
    }

    expect(world.channel.closes).toEqual([]);
  });

  it("rejects binary frames", () => {
    const world = setup();

    world.connection.receiveBinary();

    expect(world.channel.errorCodes()).toEqual(["invalid_message"]);
  });

  it("closes a client that floods the connection", async () => {
    const world = setup();

    await signIn(world);
    for (let count = 0; count < 31; count += 1) {
      await send(world, clientMessage("ping"));
    }

    expect(world.channel.closes).toEqual([
      { code: 1008, reason: "Rate limit exceeded" },
    ]);
    expect(world.channel.errorCodes()).toContain("rate_limited");
  });

  it("starts a new rate window after ten seconds", async () => {
    const world = setup();

    await signIn(world);
    for (let round = 0; round < 3; round += 1) {
      for (let count = 0; count < 20; count += 1) {
        await send(world, clientMessage("ping"));
      }
      await vi.advanceTimersByTimeAsync(10_000);
      world.connection.receivePong();
    }

    expect(world.channel.closes).toEqual([]);
  });

  it("closes a client that queues more than it waits for", async () => {
    const world = setup();

    world.authenticator.authenticate.mockReturnValue(new Promise(() => undefined));
    for (let count = 0; count < 9; count += 1) {
      world.connection.receiveText(sessionAuth(`a-${count}`));
    }

    expect(world.channel.closes).toEqual([
      { code: 1008, reason: "Too many pending messages" },
    ]);
  });

  it("ignores everything after the server started closing", async () => {
    const world = setup();

    world.connection.closeGoingAway("Pages is stopping");
    await send(world, sessionAuth());

    expect(world.channel.closes).toEqual([
      { code: 1001, reason: "Pages is stopping" },
    ]);
    expect(world.channel.sent).toEqual([]);
  });

  it("terminates the socket when it cannot be written to", async () => {
    const world = setup();

    world.channel.failSending = true;
    await send(world, "garbage");

    expect(world.channel.terminateCount).toBe(1);
  });
});

describe("heartbeat", () => {
  it("probes the peer every interval", async () => {
    const world = setup();

    await signIn(world);
    for (let tick = 1; tick <= 3; tick += 1) {
      world.connection.receivePong();
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MILLISECONDS);
    }

    expect(world.channel.pingCount).toBe(3);
    expect(world.channel.terminateCount).toBe(0);
  });

  it("drops a connection that stays silent for 45 seconds", async () => {
    const world = setup();

    await signIn(world);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(world.channel.terminateCount).toBe(0);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(world.channel.terminateCount).toBe(1);
    expect(world.channel.pingCount).toBe(2);
  });

  it("treats a message as a sign of life", async () => {
    const world = setup();

    await signIn(world);
    await vi.advanceTimersByTimeAsync(40_000);
    await send(world, clientMessage("ping"));
    await vi.advanceTimersByTimeAsync(20_000);

    expect(world.channel.terminateCount).toBe(0);
  });

  it("checks the session once a minute and keeps a valid one", async () => {
    const world = setup();

    await signIn(world);
    for (let tick = 0; tick < 6; tick += 1) {
      world.connection.receivePong();
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MILLISECONDS);
    }

    expect(world.authenticator.isSessionActive).toHaveBeenCalledWith(
      "session-token-anna",
    );
    expect(world.authenticator.isSessionActive).toHaveBeenCalledTimes(2);
    expect(world.channel.closes).toEqual([]);
  });

  it("ends the connection when its session ended", async () => {
    const world = setup();

    await signIn(world);
    world.authenticator.isSessionActive.mockResolvedValue(false);
    for (let tick = 0; tick < 3; tick += 1) {
      world.connection.receivePong();
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MILLISECONDS);
    }

    expect(world.channel.closes).toEqual([
      { code: 1008, reason: "Session ended" },
    ]);
    expect(world.channel.errorCodes()).toEqual(["authentication_failed"]);
  });

  it("keeps the connection when the session check itself fails", async () => {
    const world = setup();

    await signIn(world);
    world.authenticator.isSessionActive.mockRejectedValue(
      new Error("database busy"),
    );
    for (let tick = 0; tick < 3; tick += 1) {
      world.connection.receivePong();
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MILLISECONDS);
    }

    expect(world.channel.closes).toEqual([]);
  });

  it("does not check a session that was never established", async () => {
    const world = setup();

    for (let tick = 0; tick < 3; tick += 1) {
      world.connection.receivePong();
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MILLISECONDS);
    }

    expect(world.authenticator.isSessionActive).not.toHaveBeenCalled();
  });
});

describe("closing", () => {
  it("releases every timer and logs the end", async () => {
    const world = setup();

    await signIn(world);
    world.connection.close(1008, "Policy");
    world.connection.stop(1008);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(world.channel.pingCount).toBe(0);
    expect(world.channel.terminateCount).toBe(0);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "pica_mobile.connection.closed",
        metadata: { code: 1008, userId: "user-anna" },
      }),
    );
  });
});

describe("logging", () => {
  it("never writes credentials or tokens into a log event", async () => {
    const world = setup();

    world.authenticator.authenticate.mockResolvedValueOnce({
      ok: false,
      reason: "invalidCredentials",
    });
    await send(
      world,
      clientMessage("auth", {
        method: "password",
        username: "anna-login",
        password: "hunter2-secret",
      }),
    );
    await send(world, "hunter2-secret");
    await send(world, sessionAuth());
    world.connection.stop(1000);

    const logged = JSON.stringify(vi.mocked(logEvent).mock.calls);

    expect(logged).not.toContain("hunter2-secret");
    expect(logged).not.toContain("anna-login");
    expect(logged).not.toContain("session-token-anna");
  });

  it("logs only the first rejections of a connection", async () => {
    const world = setup();

    await signIn(world);
    vi.mocked(logEvent).mockClear();
    for (let round = 0; round < 4; round += 1) {
      await send(world, "garbage");
      await send(world, clientMessage("ping"));
    }
    await send(world, "garbage");
    await send(world, "garbage");

    const rejections = vi
      .mocked(logEvent)
      .mock.calls.filter(
        ([event]) => event.event === "pica_mobile.protocol.rejected",
      );

    expect(rejections).toHaveLength(5);
  });
});
