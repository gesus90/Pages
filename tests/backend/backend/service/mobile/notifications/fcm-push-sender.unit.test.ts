import { beforeEach, expect, it, vi } from "vitest";

import { logEvent } from "@/backend/logging/Logger";
import { FcmPicaMobilePushSender } from "@/backend/service/mobile/notifications/FcmPicaMobilePushSender";

import type { PicaMobilePushMessage } from "@/backend/service/mobile/notifications/PicaMobilePushSender";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

const ACCOUNT = {
  projectId: "project test",
  clientEmail: "test@example.org",
  privateKey: "synthetic",
};
const MESSAGE: PicaMobilePushMessage = {
  token: "device-secret",
  title: "Title",
  body: "Body",
  data: { event: "event-1" },
  channelId: "pica-plan-results",
  tag: "tag-1",
  ttlSeconds: 3_000_000,
};

function createSender(response: Response): {
  sender: FcmPicaMobilePushSender;
  fetch: ReturnType<typeof vi.fn>;
  tokens: {
    read: ReturnType<typeof vi.fn>;
    invalidate: ReturnType<typeof vi.fn>;
  };
} {
  const fetch = vi.fn().mockResolvedValue(response);
  const tokens = {
    read: vi.fn().mockResolvedValue("access-secret"),
    invalidate: vi.fn(),
  };
  const sender = new FcmPicaMobilePushSender(ACCOUNT, {
    fetch,
    tokens,
    now: () => 0,
  });
  return { sender, fetch, tokens };
}

beforeEach(() => vi.clearAllMocks());

it("sends the expected private Android message and caps its lifetime", async () => {
  const { sender, fetch } = createSender(new Response("{}", { status: 200 }));
  expect(await sender.ready()).toBe(true);
  expect(await sender.send(MESSAGE)).toEqual({ kind: "sent" });
  expect(fetch).toHaveBeenCalledWith(
    "https://fcm.googleapis.com/v1/projects/project%20test/messages:send",
    expect.objectContaining({
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "Bearer access-secret",
        "Content-Type": "application/json; charset=utf-8",
      },
    }),
  );
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    message: {
      token: "device-secret",
      data: { event: "event-1" },
      notification: { title: "Title", body: "Body" },
      android: {
        priority: "HIGH",
        ttl: "2419200s",
        notification: {
          channel_id: "pica-plan-results",
          tag: "tag-1",
          visibility: "PRIVATE",
        },
      },
    },
  });
  expect(logEvent).not.toHaveBeenCalled();
});

it.each([
  { token: "" },
  { ttlSeconds: 0 },
  { ttlSeconds: 1.5 },
  { body: "x".repeat(4000) },
])(
  "rejects an invalid or oversized payload without a request: %o",
  async (changes) => {
    const { sender, fetch, tokens } = createSender(new Response("{}"));
    expect(await sender.send({ ...MESSAGE, ...changes })).toEqual({
      kind: "rejected",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(tokens.read).not.toHaveBeenCalled();
  },
);

it.each([
  [404, {}, "rejected"],
  [
    404,
    {
      error: {
        details: [
          {
            "@type": "google.firebase.fcm.v1.FcmError",
            errorCode: "UNREGISTERED",
          },
        ],
      },
    },
    "invalidToken",
  ],
  [
    400,
    {
      error: {
        details: [
          {
            "@type": "google.rpc.BadRequest",
            fieldViolations: [{ field: "message.token" }],
          },
        ],
      },
    },
    "invalidToken",
  ],
  [
    400,
    {
      error: {
        details: [
          {
            "@type": "google.rpc.BadRequest",
            fieldViolations: [{ field: "message.data" }],
          },
        ],
      },
    },
    "rejected",
  ],
  [
    403,
    {
      error: {
        details: [
          {
            "@type": "google.firebase.fcm.v1.FcmError",
            errorCode: "SENDER_ID_MISMATCH",
          },
        ],
      },
    },
    "rejected",
  ],
  [403, {}, "unavailable"],
  [500, {}, "retry"],
])(
  "classifies status %i and provider details as %s",
  async (status, body, kind) => {
    const { sender } = createSender(
      new Response(JSON.stringify(body), { status }),
    );
    expect(await sender.send(MESSAGE)).toEqual({ kind });
  },
);

it.each([
  ["120", 120],
  ["999999", 3600],
  ["Thu, 01 Jan 1970 00:00:10 GMT", 10],
])("honors and caps retry-after %s", async (header, seconds) => {
  const { sender } = createSender(
    new Response("bad json", {
      status: 429,
      headers: { "retry-after": header },
    }),
  );
  expect(await sender.send(MESSAGE)).toEqual({
    kind: "retry",
    retryAfterSeconds: seconds,
  });
});

it("refreshes credentials once after a 401", async () => {
  const { sender, fetch, tokens } = createSender(
    new Response("{}", { status: 200 }),
  );
  fetch.mockResolvedValueOnce(new Response("{}", { status: 401 }));
  tokens.read.mockResolvedValueOnce("old").mockResolvedValueOnce("fresh");
  expect(await sender.send(MESSAGE)).toEqual({ kind: "sent" });
  expect(tokens.invalidate).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer fresh");
});

it("returns unavailable when credentials cannot be obtained or refreshed", async () => {
  const { sender, fetch, tokens } = createSender(
    new Response("{}", { status: 401 }),
  );
  tokens.read.mockResolvedValueOnce(null);
  expect(await sender.ready()).toBe(false);
  tokens.read.mockResolvedValueOnce("old").mockResolvedValueOnce(null);
  expect(await sender.send(MESSAGE)).toEqual({ kind: "unavailable" });
  expect(fetch).toHaveBeenCalledOnce();
  expect(tokens.invalidate).toHaveBeenCalledOnce();
});

it("retries network failures and never logs message or token content", async () => {
  const { sender, fetch } = createSender(new Response("{}"));
  fetch.mockRejectedValue(new Error("network failure"));
  expect(await sender.send(MESSAGE)).toEqual({ kind: "retry" });
  expect(JSON.stringify(vi.mocked(logEvent).mock.calls)).not.toContain(
    "device-secret",
  );
  expect(JSON.stringify(vi.mocked(logEvent).mock.calls)).not.toContain(
    "access-secret",
  );
});
