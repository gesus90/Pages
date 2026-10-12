import { expect, it, vi } from "vitest";

import { PairingClient } from "../../mcp/src/pairing-client";

const instance = new URL("https://pages.invalid/prefix/");
const clientInput = {
  clientName: "Pages MCP",
  device: "laptop",
  packageVersion: "0.1.0",
};
const request = {
  userCode: "BCDF-GHJK",
  deviceSecret: "s".repeat(43),
  expiresAt: 1_800_000_000_000,
  interval: 5,
};
const beginResponse = { service: "pages", apiVersion: "1", ...request };
const credential = {
  token: "t".repeat(43),
  tokenId: "token-id",
  name: "Connection",
  expiresAt: null,
  account: { displayName: "Person", username: "person" },
};

function respond(content: unknown) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json(content));
  vi.stubGlobal("fetch", fetcher);
  return { client: new PairingClient(instance), fetcher };
}

it("addresses the exact instance prefix and disallows redirects before accepting the code", async () => {
  const run = respond(beginResponse);
  await expect(run.client.begin(clientInput)).resolves.toEqual(request);
  expect(run.fetcher).toHaveBeenCalledExactlyOnceWith(
    new URL("https://pages.invalid/prefix/api/v1/pairing"),
    expect.objectContaining({
      method: "POST",
      redirect: "error",
      body: JSON.stringify(clientInput),
    }),
  );
});

it.each([
  null,
  [],
  ...[
    { service: "other" },
    { apiVersion: "2" },
    { userCode: null },
    { userCode: "ABCD-EFGH" },
    { deviceSecret: null },
    { deviceSecret: "short" },
    { expiresAt: "tomorrow" },
    { expiresAt: 1.5 },
    { interval: 10 },
  ].map((changes) => ({ ...beginResponse, ...changes })),
])(
  "rejects incomplete or foreign pairing responses without reflecting them: %j",
  async (content) => {
    const run = respond(content);
    await expect(run.client.begin(clientInput)).rejects.toMatchObject({
      code: "wrong_instance",
      message: "Pages pairing failed.",
    });
  },
);

it.each([null, 1_800_000_000_000])(
  "accepts a complete credential with expiry %j and a caller abort signal",
  async (expiresAt) => {
    const run = respond({ ...credential, expiresAt });
    const controller = new AbortController();
    await expect(
      run.client.exchange(request, controller.signal),
    ).resolves.toEqual({ ...credential, expiresAt });
    expect(run.fetcher).toHaveBeenCalledExactlyOnceWith(
      new URL("https://pages.invalid/prefix/api/v1/pairing/token"),
      expect.objectContaining({
        redirect: "error",
        body: JSON.stringify({
          userCode: request.userCode,
          deviceSecret: request.deviceSecret,
        }),
      }),
    );
  },
);

it.each([
  null,
  [],
  ...[
    { token: null },
    { token: "invalid" },
    { tokenId: null },
    { tokenId: "" },
    { name: null },
    { name: "" },
    { name: "n".repeat(101) },
    { expiresAt: "tomorrow" },
    { expiresAt: 1.5 },
    { account: null },
    { account: { displayName: null, username: "person" } },
    { account: { displayName: "Person", username: null } },
  ].map((changes) => ({ ...credential, ...changes })),
])(
  "rejects malformed credential handoffs before they can be stored: %j",
  async (content) => {
    const run = respond(content);
    await expect(run.client.exchange(request)).rejects.toMatchObject({
      code: "handoff_failed",
    });
  },
);

it.each([
  ["authorization_pending", "authorization_pending"],
  ["slow_down", "slow_down"],
  ["access_denied", "access_denied"],
  ["expired_token", "expired_token"],
  ["invalid_grant", "invalid_grant"],
  ["temporarily_unavailable", "temporarily_unavailable"],
  ["untrusted diagnostic", "wrong_instance"],
])(
  "restricts a server error %s to the public allowlist",
  async (error, expected) => {
    const run = respond(null);
    run.fetcher.mockResolvedValue(Response.json({ error }, { status: 400 }));
    await expect(run.client.exchange(request)).rejects.toMatchObject({
      code: expected,
      message: "Pages pairing failed.",
    });
  },
);

it.each([
  ["-1", 0],
  ["9999", 3600],
  ["invalid", 0],
  ["5", 5],
])("bounds retry-after %s to %s seconds", async (header, retryAfter) => {
  const run = respond(null);
  run.fetcher.mockResolvedValue(
    Response.json(
      { error: "slow_down" },
      { status: 429, headers: { "Retry-After": header } },
    ),
  );
  await expect(run.client.exchange(request)).rejects.toMatchObject({
    code: "slow_down",
    retryAfter,
  });
});

it.each([null, {}, { error: 123 }])(
  "does not expose malformed error bodies %j",
  async (content) => {
    const run = respond(null);
    run.fetcher.mockResolvedValue(Response.json(content, { status: 400 }));
    await expect(run.client.begin(clientInput)).rejects.toMatchObject({
      code: "wrong_instance",
    });
  },
);

it("rejects non-JSON responses without including response text in diagnostics", async () => {
  const run = respond(null);
  run.fetcher.mockResolvedValue(new Response("untrusted response"));
  await expect(run.client.begin(clientInput)).rejects.toMatchObject({
    code: "wrong_instance",
    message: "Pages pairing failed.",
  });
});

it.each([false, true])(
  "distinguishes a caller cancellation from a network error: %j",
  async (isCancelled) => {
    const run = respond(null);
    run.fetcher.mockRejectedValue(new Error("untrusted network diagnostic"));
    const controller = new AbortController();
    if (isCancelled) controller.abort();
    await expect(
      run.client.begin(clientInput, controller.signal),
    ).rejects.toMatchObject({
      code: isCancelled ? "cancelled" : "network",
      message: "Pages pairing failed.",
    });
  },
);

it("sends cancellation only to the original instance and keeps credentials out of the URL", async () => {
  const run = respond({ cancelled: true });
  await expect(run.client.cancel(request)).resolves.toBeUndefined();
  expect(run.fetcher).toHaveBeenCalledExactlyOnceWith(
    new URL("https://pages.invalid/prefix/api/v1/pairing/cancel"),
    expect.objectContaining({
      body: JSON.stringify({
        userCode: request.userCode,
        deviceSecret: request.deviceSecret,
      }),
    }),
  );
});
