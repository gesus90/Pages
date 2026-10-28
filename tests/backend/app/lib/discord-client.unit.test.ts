import { expect, it, vi } from "vitest";

import {
  isDiscordActionResult,
  requestDiscord,
  toEventFields,
} from "@/app/lib/discord-client";

function stubFetch(
  response: () => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => response());

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

it("reads the state with a GET and lists channels only on request", async () => {
  const fetchMock = stubFetch(() =>
    Response.json({ ok: true, state: { canManage: true }, test: null }),
  );

  await requestDiscord({ projectId: "a/b" });
  await requestDiscord({ includeChannels: true, projectId: "alpha" });

  expect(fetchMock.mock.calls.map(([address]) => address)).toEqual([
    "/projekte/a%2Fb/discord",
    "/projekte/alpha/discord?channels=1",
  ]);
});

it("posts the intent and its fields as a form", async () => {
  const fetchMock = stubFetch(() =>
    Response.json({ ok: true, state: {}, test: null }),
  );

  await requestDiscord({
    fields: { channelId: "201" },
    intent: "channel",
    projectId: "alpha",
  });

  const [address, init] = fetchMock.mock.calls[0] as [string, RequestInit];

  expect(address).toBe("/projekte/alpha/discord");
  expect(init.method).toBe("POST");
  expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
    channelId: "201",
    intent: "channel",
  });
});

it("turns a network error and a body of the wrong shape into a failed request", async () => {
  stubFetch(() => {
    throw new TypeError("offline");
  });
  await expect(requestDiscord({ projectId: "alpha" })).resolves.toEqual({
    error: "request_failed",
    ok: false,
  });

  stubFetch(() => Response.json({ unexpected: true }));
  await expect(requestDiscord({ projectId: "alpha" })).resolves.toEqual({
    error: "request_failed",
    ok: false,
  });

  stubFetch(() => new Response("<html>gateway</html>", { status: 502 }));
  await expect(requestDiscord({ projectId: "alpha" })).resolves.toEqual({
    error: "request_failed",
    ok: false,
  });
});

it("passes a refusal of the server on with its code", async () => {
  stubFetch(() =>
    Response.json({ error: "forbidden", ok: false }, { status: 403 }),
  );

  await expect(
    requestDiscord({ intent: "start", projectId: "alpha" }),
  ).resolves.toEqual({
    error: "forbidden",
    ok: false,
  });
});

it("recognises only results with a state or a code", () => {
  expect(isDiscordActionResult({ ok: true, state: {}, test: null })).toBe(true);
  expect(isDiscordActionResult({ error: "forbidden", ok: false })).toBe(true);

  for (const value of [
    null,
    "x",
    5,
    { ok: true },
    { ok: false },
    { ok: 1 },
    [],
  ]) {
    expect(isDiscordActionResult(value)).toBe(false);
  }
});

it("writes event switches as form values", () => {
  expect(
    toEventFields({ "ticket.created": true, "ticket.updated": false }),
  ).toEqual({
    "ticket.created": "on",
    "ticket.updated": "",
  });
});
