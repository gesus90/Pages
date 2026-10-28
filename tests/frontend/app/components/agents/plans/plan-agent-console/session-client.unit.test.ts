import { expect, it, vi } from "vitest";

import {
  mergeEvents,
  postSessionCommand,
  readSessionPage,
} from "@/app/components/agents/plans/plan-agent-console/session-client";

import { SESSION_VIEW, historyEvent } from "../../page161-session-fixture";

const ADDRESS = "/agent-api/plan-runs/run/steps/node/session?planId=plan";

type FetchStub = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function stubFetch(answer: FetchStub): ReturnType<typeof vi.fn<FetchStub>> {
  const fetchStub = vi.fn<FetchStub>(answer);
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

const READ = {
  ok: true,
  view: SESSION_VIEW,
  page: {
    events: [historyEvent(1)],
    cursor: 1,
    hasMore: false,
    retainedFrom: null,
    source: "journal",
  },
};

it("reads a page after the cursor as JSON with the tail or before window in the query", async () => {
  const fetchStub = stubFetch(async () => Response.json(READ));
  const signal = new AbortController().signal;
  expect(await readSessionPage(ADDRESS, 4, signal)).toEqual(READ);
  await readSessionPage(ADDRESS, 0, signal, { tail: true });
  await readSessionPage(ADDRESS, 0, signal, { before: 9, tail: false });
  expect(fetchStub.mock.calls.map((call) => String(call[0]))).toEqual([
    `${ADDRESS}&after=4`,
    `${ADDRESS}&after=0&tail=1`,
    `${ADDRESS}&after=0&before=9`,
  ]);
  expect(fetchStub.mock.calls[0]?.[1]).toEqual({
    headers: { Accept: "application/json" },
    signal,
  });
});

it("tells a cancelled read from an offline one", async () => {
  stubFetch(async () => {
    throw new TypeError("network");
  });
  const controller = new AbortController();
  expect(await readSessionPage(ADDRESS, 0, controller.signal)).toEqual({
    ok: false,
    error: "offline",
  });
  controller.abort();
  expect(await readSessionPage(ADDRESS, 0, controller.signal)).toEqual({
    ok: false,
    error: "cancelled",
  });
});

it("reports the server's error code, or a general failure for unreadable or bare answers", async () => {
  const signal = new AbortController().signal;
  stubFetch(async () =>
    Response.json({ ok: false, error: "plan_access_denied" }, { status: 403 }),
  );
  expect(await readSessionPage(ADDRESS, 0, signal)).toEqual({
    ok: false,
    error: "plan_access_denied",
  });
  stubFetch(async () => new Response("not json", { status: 200 }));
  expect(await readSessionPage(ADDRESS, 0, signal)).toEqual({
    ok: false,
    error: "general",
  });
  stubFetch(async () => Response.json("refused", { status: 500 }));
  expect(await readSessionPage(ADDRESS, 0, signal)).toEqual({
    ok: false,
    error: "general",
  });
});

it("posts a command as form fields and returns the confirmed result", async () => {
  const confirmed = { ok: true, intent: "send", delivery: "queued" };
  const fetchStub = stubFetch(async () => Response.json(confirmed));
  expect(
    await postSessionCommand(ADDRESS, { intent: "send", text: "Go on" }),
  ).toEqual(confirmed);
  const init = fetchStub.mock.calls[0]?.[1];
  expect(fetchStub.mock.calls[0]?.[0]).toBe(ADDRESS);
  expect(init?.method).toBe("POST");
  const body = init?.body;
  if (!(body instanceof FormData)) throw new Error("Form body missing");
  expect(Object.fromEntries(body.entries())).toEqual({
    intent: "send",
    text: "Go on",
  });
});

it("reports offline, server and unreadable command failures with the intent", async () => {
  stubFetch(async () => {
    throw new TypeError("network");
  });
  expect(await postSessionCommand(ADDRESS, { intent: "cancel" })).toEqual({
    ok: false,
    intent: "cancel",
    error: "offline",
  });
  expect(await postSessionCommand(ADDRESS, {})).toEqual({
    ok: false,
    intent: "",
    error: "offline",
  });
  stubFetch(async () =>
    Response.json({ error: "plan_session_busy" }, { status: 409 }),
  );
  expect(await postSessionCommand(ADDRESS, { intent: "send" })).toEqual({
    ok: false,
    intent: "send",
    error: "plan_session_busy",
  });
  stubFetch(async () => new Response("", { status: 502 }));
  expect(await postSessionCommand(ADDRESS, {})).toEqual({
    ok: false,
    intent: "",
    error: "general",
  });
});

it("keeps only the latest 150 events in sequence order", () => {
  const many = Array.from({ length: 160 }, (_, index) =>
    historyEvent(160 - index),
  );
  const merged = mergeEvents([historyEvent(5)], many);
  expect(merged).toHaveLength(150);
  expect(merged[0]?.sequence).toBe(11);
  expect(merged.at(-1)?.sequence).toBe(160);
});
