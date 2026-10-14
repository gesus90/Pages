import { beforeEach, describe, expect, it, vi } from "vitest";

import { PairingClient, PairingClientError } from "../../src/pairing-client.ts";

import type { DevicePairingRequest } from "../../src/pairing-client.ts";

const INSTANCE = new URL("https://pages.example/team");
const DEVICE_SECRET = "s".repeat(43);
const TOKEN = "a".repeat(43);
const BEGIN_INPUT = {
  clientName: "Pages MCP",
  device: "workstation",
  packageVersion: "0.1.0",
};
const VALID_BEGIN = {
  service: "pages",
  apiVersion: "1",
  userCode: "BCDF-GHJK",
  deviceSecret: DEVICE_SECRET,
  expiresAt: 1_800_000_000_000,
  interval: 5,
};
const REQUEST: DevicePairingRequest = {
  userCode: "BCDF-GHJK",
  deviceSecret: DEVICE_SECRET,
  expiresAt: 1_800_000_000_000,
  interval: 5,
};
const VALID_EXCHANGE = {
  token: TOKEN,
  tokenId: "token-1",
  name: "Pages MCP",
  expiresAt: null,
  account: { displayName: "Ada Lovelace", username: "ada" },
};

const fetchMock = vi.fn<typeof fetch>();

/** Answers every request with a fresh JSON response, since a body is readable once. */
function respondWith(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): void {
  fetchMock.mockImplementation(async () =>
    Response.json(body, { status: init.status ?? 200, headers: init.headers }),
  );
}

/** Captures the code of the rejected pairing error. */
async function failureOf(
  operation: Promise<unknown>,
): Promise<PairingClientError> {
  const error = await operation.then(
    () => new Error("expected a pairing failure"),
    (failure: unknown) => failure,
  );
  if (!(error instanceof PairingClientError)) throw error;
  return error;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("PairingClientError", () => {
  it("keeps a fixed message and defaults retryAfter to zero", () => {
    const error = new PairingClientError("network");

    expect(error.message).toBe("Pages pairing failed.");
    expect(error.code).toBe("network");
    expect(error.retryAfter).toBe(0);
  });
});

describe("PairingClient requests", () => {
  it("posts JSON beneath the instance prefix without following redirects", async () => {
    respondWith(VALID_BEGIN);

    await new PairingClient(INSTANCE).begin(BEGIN_INPUT);

    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(String(endpoint)).toBe("https://pages.example/team/api/v1/pairing");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual(BEGIN_INPUT);
  });

  it("links the caller's signal to the request", async () => {
    respondWith(VALID_BEGIN);
    const controller = new AbortController();

    await new PairingClient(INSTANCE).begin(BEGIN_INPUT, controller.signal);
    const requestSignal = fetchMock.mock.calls[0][1]?.signal;
    controller.abort();

    expect(requestSignal?.aborted).toBe(true);
  });

  it("collects the credential with the device secret", async () => {
    respondWith(VALID_EXCHANGE);

    await expect(
      new PairingClient(INSTANCE).exchange(REQUEST),
    ).resolves.toEqual(VALID_EXCHANGE);

    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(String(endpoint)).toBe(
      "https://pages.example/team/api/v1/pairing/token",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      userCode: "BCDF-GHJK",
      deviceSecret: DEVICE_SECRET,
    });
  });

  it("cancels an uncollected request", async () => {
    respondWith({ cancelled: true });

    await new PairingClient(INSTANCE).cancel(REQUEST);

    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(String(endpoint)).toBe(
      "https://pages.example/team/api/v1/pairing/cancel",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      userCode: "BCDF-GHJK",
      deviceSecret: DEVICE_SECRET,
    });
  });
});

describe("PairingClient transport failures", () => {
  it("reports a network failure without a signal", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const error = await failureOf(new PairingClient(INSTANCE).cancel(REQUEST));

    expect(error.code).toBe("network");
  });

  it("reports a network failure while the caller has not aborted", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const controller = new AbortController();

    const error = await failureOf(
      new PairingClient(INSTANCE).begin(BEGIN_INPUT, controller.signal),
    );

    expect(error.code).toBe("network");
  });

  it("reports cancellation when the caller aborted", async () => {
    fetchMock.mockRejectedValue(new DOMException("aborted", "AbortError"));
    const controller = new AbortController();
    controller.abort();

    const error = await failureOf(
      new PairingClient(INSTANCE).exchange(REQUEST, controller.signal),
    );

    expect(error.code).toBe("cancelled");
  });

  it("rejects a body that is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>proxy</html>"));

    const error = await failureOf(
      new PairingClient(INSTANCE).begin(BEGIN_INPUT),
    );

    expect(error.code).toBe("wrong_instance");
  });
});

describe("PairingClient protocol errors", () => {
  it.each([
    "authorization_pending",
    "slow_down",
    "access_denied",
    "expired_token",
    "invalid_grant",
    "temporarily_unavailable",
  ])("passes the allowed error %s through", async (code) => {
    respondWith({ error: code }, { status: 400 });

    const error = await failureOf(
      new PairingClient(INSTANCE).exchange(REQUEST),
    );

    expect(error.code).toBe(code);
    expect(error.retryAfter).toBe(0);
  });

  it.each([
    { body: { error: "internal_detail" }, reason: "an unknown error code" },
    { body: { error: 42 }, reason: "a non-string error" },
    { body: ["slow_down"], reason: "an array body" },
    { body: null, reason: "a null body" },
  ])("maps $reason to wrong_instance", async ({ body }) => {
    respondWith(body, { status: 500 });

    const error = await failureOf(
      new PairingClient(INSTANCE).exchange(REQUEST),
    );

    expect(error.code).toBe("wrong_instance");
  });

  it.each([
    { header: "12", expected: 12 },
    { header: "7200", expected: 3600 },
    { header: "-4", expected: 0 },
    { header: "soon", expected: 0 },
  ])(
    "clamps Retry-After $header to $expected",
    async ({ header, expected }) => {
      respondWith(
        { error: "slow_down" },
        { status: 429, headers: { "Retry-After": header } },
      );

      const error = await failureOf(
        new PairingClient(INSTANCE).exchange(REQUEST),
      );

      expect(error.code).toBe("slow_down");
      expect(error.retryAfter).toBe(expected);
    },
  );
});

describe("PairingClient.begin validation", () => {
  it("returns only the device request fields", async () => {
    respondWith({ ...VALID_BEGIN, extra: "ignored" });

    await expect(
      new PairingClient(INSTANCE).begin(BEGIN_INPUT),
    ).resolves.toEqual(REQUEST);
  });

  it.each([
    { reason: "a non-object body", body: "pages" },
    { reason: "another service", body: { ...VALID_BEGIN, service: "other" } },
    {
      reason: "another API version",
      body: { ...VALID_BEGIN, apiVersion: "2" },
    },
    { reason: "a missing user code", body: { ...VALID_BEGIN, userCode: 7 } },
    {
      reason: "a malformed user code",
      body: { ...VALID_BEGIN, userCode: "ABCD-EFGH" },
    },
    {
      reason: "a missing secret",
      body: { ...VALID_BEGIN, deviceSecret: null },
    },
    {
      reason: "a short secret",
      body: { ...VALID_BEGIN, deviceSecret: "s".repeat(42) },
    },
    { reason: "a textual expiry", body: { ...VALID_BEGIN, expiresAt: "soon" } },
    { reason: "a fractional expiry", body: { ...VALID_BEGIN, expiresAt: 1.5 } },
    { reason: "another interval", body: { ...VALID_BEGIN, interval: 1 } },
  ])("rejects $reason as wrong_instance", async ({ body }) => {
    respondWith(body);

    const error = await failureOf(
      new PairingClient(INSTANCE).begin(BEGIN_INPUT),
    );

    expect(error.code).toBe("wrong_instance");
  });
});

describe("PairingClient.exchange validation", () => {
  it("accepts a dated credential and drops unknown fields", async () => {
    respondWith({
      ...VALID_EXCHANGE,
      expiresAt: 1_900_000_000_000,
      account: { ...VALID_EXCHANGE.account, isAdmin: true },
      secret: "ignored",
    });

    await expect(
      new PairingClient(INSTANCE).exchange(REQUEST),
    ).resolves.toEqual({ ...VALID_EXCHANGE, expiresAt: 1_900_000_000_000 });
  });

  it.each([
    { reason: "a non-object body", body: [VALID_EXCHANGE] },
    { reason: "a missing token", body: { ...VALID_EXCHANGE, token: 1 } },
    { reason: "a malformed token", body: { ...VALID_EXCHANGE, token: "a b" } },
    { reason: "a missing token id", body: { ...VALID_EXCHANGE, tokenId: 1 } },
    { reason: "an empty token id", body: { ...VALID_EXCHANGE, tokenId: "" } },
    { reason: "a missing name", body: { ...VALID_EXCHANGE, name: null } },
    { reason: "an empty name", body: { ...VALID_EXCHANGE, name: "" } },
    {
      reason: "a long name",
      body: { ...VALID_EXCHANGE, name: "n".repeat(101) },
    },
    { reason: "a textual expiry", body: { ...VALID_EXCHANGE, expiresAt: "1" } },
    {
      reason: "a fractional expiry",
      body: { ...VALID_EXCHANGE, expiresAt: 0.5 },
    },
    { reason: "a missing account", body: { ...VALID_EXCHANGE, account: null } },
    {
      reason: "a missing display name",
      body: { ...VALID_EXCHANGE, account: { username: "ada" } },
    },
    {
      reason: "a missing username",
      body: { ...VALID_EXCHANGE, account: { displayName: "Ada" } },
    },
  ])("rejects $reason as handoff_failed", async ({ body }) => {
    respondWith(body);

    const error = await failureOf(
      new PairingClient(INSTANCE).exchange(REQUEST),
    );

    expect(error.code).toBe("handoff_failed");
  });
});
