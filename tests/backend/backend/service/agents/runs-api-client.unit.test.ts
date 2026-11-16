import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { RunnerService } from "@/backend/service/runner/RunnerService";

const call = vi.hoisted(() => vi.fn());
vi.mock("@/backend/service/agents/runs/RunsSocket", () => ({
  callRunApi: call,
}));

import { RunApiClient } from "@/backend/service/agents/runs/RunApiClient";

const facts = {
  availability: null,
  pages: true,
  assets: true,
  largeAssets: false,
  openCode: true,
  exactPayload: true,
  continuation: true,
  contact: { state: "connected", lastContactAt: "now" },
};
const readers = partial<RunnerService>({
  catalog: vi.fn(async () => undefined),
  progress: vi.fn(async () => undefined),
  historyPending: vi.fn(async () => 3),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01"));
  vi.resetAllMocks();
  call.mockResolvedValue(facts);
});
afterEach(() => vi.useRealTimers());

it("uses fresh capability evidence and expires it after 45 seconds", async () => {
  const client = new RunApiClient("socket", readers);
  expect(client.supportsPagesAccess("connection")).toBe(false);
  expect(await client.availability("connection")).toBeNull();
  expect(client.supportsPagesAccess("connection")).toBe(true);
  expect(client.supportsAssetFiles("connection")).toBe(true);
  expect(client.supportsLargeAssetFiles("connection")).toBe(false);
  expect(client.supportsOpenCode("connection")).toBe(true);
  expect(client.supportsExactResultPayload("connection")).toBe(true);
  expect(client.supportsContinuation("connection")).toBe(true);
  expect(client.contact("connection")).toEqual(facts.contact);
  vi.advanceTimersByTime(45_000);
  expect(client.supportsPagesAccess("connection")).toBe(false);
  expect(client.contact("connection")).toEqual({
    state: "lost",
    lastContactAt: null,
  });
});

it("clears capabilities when a refresh fails with a domain error", async () => {
  const client = new RunApiClient("socket", readers);
  await client.availability("connection");
  call.mockRejectedValue(new AgentError("plan_remote_unavailable"));
  expect(await client.availability("connection")).toBe("remoteOffline");
  expect(client.supportsPagesAccess("connection")).toBe(false);
});

it("delegates durable progress and cancellation without a live connection", async () => {
  const client = new RunApiClient("socket", readers);
  await client.cancel("connection", "job");
  expect(call).toHaveBeenCalledWith("socket", {
    version: 1,
    operation: "cancel",
    connectionId: "connection",
    jobId: "job",
  });
  await client.pauseQueued("connection", "job");
  expect(call).toHaveBeenLastCalledWith("socket", {
    version: 1,
    operation: "pauseQueued",
    connectionId: "connection",
    jobId: "job",
  });
  await expect(client.historyPending("job")).resolves.toBe(3);
  await expect(client.enqueue("user", "connection")).rejects.toThrow(
    "exact binding",
  );
});
