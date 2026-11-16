import { afterEach, expect, it, vi } from "vitest";

import { AgentCatalogScheduler } from "@/backend/service/agents/AgentCatalogScheduler";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentCatalogRepository } from "@/backend/database/repositories/agent/AgentCatalogRepository";
import type { AgentCatalogRefresh } from "@/backend/service/agents/AgentCatalogRefresh";

afterEach(() => vi.useRealTimers());

it("polls on the minute and stops future work on shutdown", async () => {
  vi.useFakeTimers();
  const nextDue = vi.fn(async () => "connection");
  const run = vi.fn(async () => undefined);
  const shutdown = vi.fn(async () => undefined);
  const scheduler = new AgentCatalogScheduler(
    partial<AgentCatalogRepository>({ nextDue }),
    partial<AgentCatalogRefresh>({ run, shutdown }),
  );
  scheduler.start();
  scheduler.start();
  expect(nextDue).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(run).toHaveBeenCalledExactlyOnceWith("connection");
  await scheduler.shutdown();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(nextDue).toHaveBeenCalledOnce();
  expect(shutdown).toHaveBeenCalledOnce();
});

it("does not overlap a pending scan and does not refresh after shutdown begins", async () => {
  let resolve: (id: string | null) => void = () => {};
  const nextDue = vi.fn(
    () =>
      new Promise<string | null>((done) => {
        resolve = done;
      }),
  );
  const run = vi.fn(async () => undefined);
  const scheduler = new AgentCatalogScheduler(
    partial<AgentCatalogRepository>({ nextDue }),
    partial<AgentCatalogRefresh>({ run, shutdown: async () => undefined }),
  );
  const first = scheduler.runOnce();
  await scheduler.runOnce();
  expect(nextDue).toHaveBeenCalledOnce();
  const stopping = scheduler.shutdown();
  resolve("connection");
  await Promise.all([first, stopping]);
  expect(run).not.toHaveBeenCalled();
  await scheduler.runOnce();
  expect(nextDue).toHaveBeenCalledOnce();
});
