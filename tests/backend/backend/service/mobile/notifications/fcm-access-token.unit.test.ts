import { expect, it, vi } from "vitest";

import type * as Crypto from "node:crypto";

const signer = vi.hoisted(() => vi.fn(() => Buffer.from("signature")));
vi.mock("node:crypto", async (original) => ({
  ...(await original<typeof Crypto>()),
  sign: signer,
}));

import { FcmAccessTokenProvider } from "@/backend/service/mobile/notifications/FcmAccessToken";
import { FCM_TOKEN_ENDPOINT } from "@/backend/service/mobile/notifications/FcmServiceAccount";

import type { FcmFetch } from "@/backend/service/mobile/notifications/FcmAccessToken";

const account = {
  projectId: "project-123",
  clientEmail: "service@example.com",
  privateKey: "simulated",
};

it("shares concurrent refreshes and caches tokens until the refresh margin", async () => {
  let now = 0;
  const fetcher = vi.fn<FcmFetch>(
    async () =>
      new Response(JSON.stringify({ access_token: "token", expires_in: 3600 })),
  );
  const provider = new FcmAccessTokenProvider(account, {
    fetch: fetcher,
    now: () => now,
  });
  expect(await Promise.all([provider.read(), provider.read()])).toEqual([
    "token",
    "token",
  ]);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe(FCM_TOKEN_ENDPOINT);
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: "POST",
    redirect: "error",
  });
  now = 3_299_999;
  expect(await provider.read()).toBe("token");
  expect(fetcher).toHaveBeenCalledOnce();
  now += 1;
  await provider.read();
  expect(fetcher).toHaveBeenCalledTimes(2);
  provider.invalidate();
  await provider.read();
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it.each([
  { access_token: "bad token", expires_in: 3600 },
  { access_token: "", expires_in: 3600 },
  { access_token: "x".repeat(4097), expires_in: 3600 },
  { access_token: "token", expires_in: "3600" },
  null,
])("rejects malformed token responses", async (body) => {
  const fetcher = vi.fn<FcmFetch>(
    async () => new Response(JSON.stringify(body)),
  );
  expect(
    await new FcmAccessTokenProvider(account, { fetch: fetcher }).read(),
  ).toBeNull();
});

it("handles HTTP and transport failures without returning a token", async () => {
  const failed = vi.fn<FcmFetch>(
    async () => new Response("failure", { status: 403 }),
  );
  expect(
    await new FcmAccessTokenProvider(account, { fetch: failed }).read(),
  ).toBeNull();
  const offline = vi.fn<FcmFetch>(async () => {
    throw new Error("offline");
  });
  expect(
    await new FcmAccessTokenProvider(account, { fetch: offline }).read(),
  ).toBeNull();
});
