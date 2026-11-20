import { expect, it } from "vitest";

import {
  isPollingLogContext,
  isPollingRequest,
  withPollingLogPolicy,
} from "./PollingLogPolicy";

it.each([
  ["/account-version", "GET"],
  ["/health", "HEAD"],
  ["/health/live", "GET"],
  ["/health/", "GET"],
  ["/health/live.data", "GET"],
  ["/agent-api/resources?page=2", "GET"],
  ["/agent-api/plan-runs", "GET"],
  ["/settings-api/agents/agent-7/login", "GET"],
  ["/settings-api/system/dashboard.data", "HEAD"],
])(
  "classifies the read-only status route %s with %s as polling",
  (url, method) => {
    expect(isPollingRequest(url, method)).toBe(true);
  },
);

it("does not classify writes or other methods as polling", () => {
  expect(isPollingRequest("/health", "POST")).toBe(false);
  expect(isPollingRequest("/account-version", "DELETE")).toBe(false);
});

it("does not classify routes outside the allowlist", () => {
  expect(isPollingRequest("/health/deep", "GET")).toBe(false);
  expect(isPollingRequest("/settings-api/agents//login", "GET")).toBe(false);
  expect(isPollingRequest("/", "GET")).toBe(false);
});

it("keeps ordinary logging for malformed request URLs", () => {
  expect(isPollingRequest("http://[", "GET")).toBe(false);
});

it("carries the classification only inside the scoped work", async () => {
  expect(isPollingLogContext()).toBe(false);

  const observed = withPollingLogPolicy(true, () => isPollingLogContext());
  const nested = withPollingLogPolicy(true, () =>
    withPollingLogPolicy(false, () => isPollingLogContext()),
  );
  const asyncObserved = await withPollingLogPolicy(true, async () => {
    await Promise.resolve();
    return isPollingLogContext();
  });

  expect(observed).toBe(true);
  expect(nested).toBe(false);
  expect(asyncObserved).toBe(true);
  expect(isPollingLogContext()).toBe(false);
});
