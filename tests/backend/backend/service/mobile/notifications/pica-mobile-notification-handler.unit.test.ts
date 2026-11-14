import { expect, it, vi } from "vitest";

import { logCaughtError } from "@/backend/logging/Logger";
import { PicaMobileNotificationHandler } from "@/backend/service/mobile/notifications/PicaMobileNotificationHandler";

import type { PicaMobileNotificationHost } from "@/backend/service/mobile/notifications/PicaMobileNotificationHandler";
import type { PicaMobileNotificationClientMessage } from "@/backend/service/mobile/notifications/PicaMobileNotificationMessages";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const SESSION = { userId: "user-1", sessionToken: "session-1" };
const GET: PicaMobileNotificationClientMessage = {
  type: "notification_settings_get",
  requestId: "request-1",
  payload: {},
};
const REGISTER: PicaMobileNotificationClientMessage = {
  type: "notification_register",
  requestId: "request-1",
  payload: {
    deviceId: "device-1",
    token: "token",
    locale: "en",
    preview: "hidden",
  },
};
const REGISTERED = {
  deviceId: "device-1",
  instanceId: "instance-1",
  accountId: "user-1",
  registeredAt: "2026-01-01T00:00:00Z",
  replayTtlSeconds: 60,
};

function createHarness(): {
  host: PicaMobileNotificationHost & {
    session: ReturnType<typeof vi.fn>;
    isOpen: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    reject: ReturnType<typeof vi.fn>;
    rejectUnauthenticated: ReturnType<typeof vi.fn>;
    acknowledge: ReturnType<typeof vi.fn>;
    endSession: ReturnType<typeof vi.fn>;
    reportFailure: ReturnType<typeof vi.fn>;
  };
  provider: {
    isPushAvailable: ReturnType<typeof vi.fn>;
    register: ReturnType<typeof vi.fn>;
    unregister: ReturnType<typeof vi.fn>;
    readEvent: ReturnType<typeof vi.fn>;
    readSettings: ReturnType<typeof vi.fn>;
    changeSettings: ReturnType<typeof vi.fn>;
  };
  handler: PicaMobileNotificationHandler;
} {
  const host = {
    session: vi.fn().mockReturnValue(SESSION),
    isOpen: vi.fn().mockReturnValue(true),
    send: vi.fn().mockReturnValue(true),
    reject: vi.fn(),
    rejectUnauthenticated: vi.fn(),
    acknowledge: vi.fn(),
    endSession: vi.fn(),
    reportFailure: vi.fn(),
  };
  const provider = {
    isPushAvailable: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
    readEvent: vi.fn(),
    readSettings: vi.fn(),
    changeSettings: vi.fn(),
  };
  return {
    host,
    provider,
    handler: new PicaMobileNotificationHandler(provider, host),
  };
}

it("ignores a closed connection and refuses unknown or unauthenticated requests", async () => {
  const { host, provider, handler } = createHarness();
  host.isOpen.mockReturnValueOnce(false);
  await handler.handle(GET);
  expect(provider.readSettings).not.toHaveBeenCalled();
  await new PicaMobileNotificationHandler(undefined, host).handle(GET);
  expect(host.reject).toHaveBeenCalledWith(
    expect.objectContaining({ requestId: "request-1", code: "unknown_type" }),
  );
  host.session.mockReturnValueOnce(null);
  await handler.handle(GET);
  expect(host.rejectUnauthenticated).toHaveBeenCalledWith("request-1");
});

it("answers settings changes for the authenticated session", async () => {
  const { host, provider, handler } = createHarness();
  const payload = { accountId: "user-1", teamRuns: { isEnabled: true } };
  provider.changeSettings.mockResolvedValue({ kind: "ready", payload });
  await handler.handle({
    type: "notification_settings_set",
    requestId: "request-1",
    payload: { teamRuns: true },
  });
  expect(provider.changeSettings).toHaveBeenCalledWith(SESSION, {
    teamRuns: true,
  });
  expect(host.acknowledge).toHaveBeenCalledOnce();
  expect(JSON.parse(host.send.mock.calls[0][0])).toMatchObject({
    requestId: "request-1",
    payload,
  });
});

it.each(["sessionEnded", "pushUnavailable"])(
  "handles settings outcome %s",
  async (kind) => {
    const { host, provider, handler } = createHarness();
    provider.readSettings.mockResolvedValue({ kind });
    await handler.handle(GET);
    if (kind === "sessionEnded")
      expect(host.endSession).toHaveBeenCalledWith("request-1");
    else
      expect(host.reject).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "request-1" }),
      );
    expect(host.send).not.toHaveBeenCalled();
  },
);

it("activates a registration only after the answer is sent", async () => {
  const { host, provider, handler } = createHarness();
  const activate = vi.fn().mockResolvedValue(undefined);
  provider.register.mockResolvedValue({
    kind: "registered",
    payload: REGISTERED,
    activate,
  });
  await handler.handle(REGISTER);
  expect(provider.register).toHaveBeenCalledWith(SESSION, REGISTER.payload);
  expect(JSON.parse(host.send.mock.calls[0][0])).toMatchObject({
    requestId: "request-1",
    payload: REGISTERED,
  });
  expect(activate).toHaveBeenCalledOnce();
  expect(host.send.mock.invocationCallOrder[0]).toBeLessThan(
    activate.mock.invocationCallOrder[0],
  );
  host.send.mockReturnValue(false);
  await handler.handle(REGISTER);
  expect(activate).toHaveBeenCalledOnce();
});

it("reports provider failures and logs activation failures without a second answer", async () => {
  const { host, provider, handler } = createHarness();
  const failure = new Error("failed");
  provider.readSettings.mockRejectedValue(failure);
  await handler.handle(GET);
  expect(host.reportFailure).toHaveBeenCalledWith("request-1", failure);
  provider.register.mockResolvedValue({
    kind: "registered",
    payload: REGISTERED,
    activate: vi.fn().mockRejectedValue(failure),
  });
  await handler.handle(REGISTER);
  expect(logCaughtError).toHaveBeenCalledWith(
    "PicaMobileNotificationHandler",
    failure,
  );
  expect(host.send).toHaveBeenCalledOnce();
});

it("acknowledges unregistration and ends an expired session", async () => {
  const { host, provider, handler } = createHarness();
  const message: PicaMobileNotificationClientMessage = {
    type: "notification_unregister",
    requestId: "request-1",
    payload: { deviceId: "device-1" },
  };
  provider.unregister
    .mockResolvedValueOnce({ kind: "done" })
    .mockResolvedValueOnce({ kind: "sessionEnded" });
  await handler.handle(message);
  expect(provider.unregister).toHaveBeenCalledWith(SESSION, "device-1");
  expect(JSON.parse(host.send.mock.calls[0][0])).toMatchObject({
    payload: { deviceId: "device-1" },
  });
  await handler.handle(message);
  expect(host.endSession).toHaveBeenCalledWith("request-1");
  expect(host.send).toHaveBeenCalledOnce();
});
