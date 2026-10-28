import { expect, it } from "vitest";

import {
  planPollingEtag,
  planPollingResponse,
} from "@/app/lib/agent-plan-poll-response.server";

function requestWith(etag?: string): Request {
  return new Request("http://pages.invalid/", {
    headers: etag === undefined ? {} : { "If-None-Match": etag },
  });
}

it("marks the snapshot as a weak SHA-256 entity tag", () => {
  expect(planPollingEtag({ status: "running" })).toMatch(
    /^W\/"[0-9a-f]{64}"$/u,
  );
  expect(planPollingEtag({ status: "running" })).not.toBe(
    planPollingEtag({ status: "paused" }),
  );
});

it("ignores only the observation time of a progress object", () => {
  const first = { progress: { step: 1, observedAt: "2026-10-28T00:00:00Z" } };
  const later = { progress: { step: 1, observedAt: "2026-10-28T00:00:02Z" } };
  const moved = { progress: { step: 2, observedAt: "2026-10-28T00:00:02Z" } };

  expect(planPollingEtag(first)).toBe(planPollingEtag(later));
  expect(planPollingEtag(first)).not.toBe(planPollingEtag(moved));
});

it("keeps observation times outside a progress object significant", () => {
  expect(planPollingEtag({ run: { observedAt: "a" } })).not.toBe(
    planPollingEtag({ run: { observedAt: "b" } }),
  );
  expect(planPollingEtag({ progress: null })).not.toBe(
    planPollingEtag({ progress: "x" }),
  );
  expect(planPollingEtag({ progress: { step: 1 } })).not.toBe(
    planPollingEtag({ progress: { step: 2 } }),
  );
});

it("answers the full snapshot when the client has another version", async () => {
  const result = { status: "running", progress: { observedAt: "now" } };
  const response = planPollingResponse(requestWith('W/"old"'), result);

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe(
    "application/json; charset=utf-8",
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("ETag")).toBe(planPollingEtag(result));
  expect(await response.json()).toEqual(result);
});

it("answers an unchanged snapshot with an empty 304", async () => {
  const result = { status: "paused" };
  const etag = planPollingEtag(result);
  const response = planPollingResponse(requestWith(etag), result);

  expect(response.status).toBe(304);
  expect(response.headers.get("ETag")).toBe(etag);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.text()).toBe("");
});

it("answers the first read without a version in full", async () => {
  const response = planPollingResponse(requestWith(), { status: "done" });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "done" });
});
