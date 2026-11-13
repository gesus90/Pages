import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { startVisiblePolling } from "@/app/components/agents/plans/plan-visible-polling";
import { useSystemDashboard } from "@/app/components/settings/system/system-dashboard/use-system-dashboard";
import { readServiceStatusDetails } from "@/app/lib/service-status";

import type { SystemDashboard } from "@/definition/SystemDashboard";

vi.mock("@/app/components/agents/plans/plan-visible-polling", () => ({
  startVisiblePolling: vi.fn(),
}));
vi.mock("@/app/lib/service-status", () => ({
  readServiceStatusDetails: vi.fn(),
}));

const MEASUREMENT: SystemDashboard = {
  measuredAt: 1000,
  processor: { usage: 0.5, load: null, cores: 4, temperature: null },
  memory: null,
  swap: null,
  agents: null,
  disks: [],
  facts: {
    version: "1",
    nodeVersion: "22",
    pagesStartedAt: 0,
    serverStartedAt: null,
    databaseSize: null,
    dataDirectorySize: null,
    tools: null,
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("retains the last measurement on failure and clears it when access is denied", async () => {
  let poll: ((wasHidden: boolean) => Promise<number | null>) | undefined;
  const stop = vi.fn();
  vi.mocked(startVisiblePolling).mockImplementation((read) => {
    poll = read;
    return stop;
  });
  vi.mocked(readServiceStatusDetails).mockResolvedValue({
    kind: "unreachable",
  });
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(MEASUREMENT)))
    .mockResolvedValueOnce(new Response("error", { status: 500 }))
    .mockResolvedValueOnce(new Response(null, { status: 403 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(Date, "now").mockReturnValue(10_000);
  const { result, unmount } = renderHook(() => useSystemDashboard());
  if (!poll) throw new Error("Polling did not start");
  const read = poll;

  await act(async () => {
    expect(await read(false)).toBe(2000);
  });
  expect(result.current.dashboard).toEqual(MEASUREMENT);
  expect(result.current.history.processor).toEqual([
    { at: 10_000, ratio: 0.5 },
  ]);
  expect(result.current.receivedAt).toBe(10_000);
  await act(async () => {
    await read(false);
  });
  expect(result.current.dashboard).toEqual(MEASUREMENT);
  expect(result.current.history.processor).toHaveLength(1);
  await act(async () => {
    await read(false);
  });
  expect(result.current.dashboard).toBeNull();
  expect(result.current.history.processor).toEqual([]);
  expect(result.current.services).toEqual({ kind: "unreachable" });
  unmount();
  expect(stop).toHaveBeenCalledOnce();
});

it("records a gap after a hidden period and ignores an invalid response", async () => {
  let poll: ((wasHidden: boolean) => Promise<number | null>) | undefined;
  vi.mocked(startVisiblePolling).mockImplementation((read) => {
    poll = read;
    return vi.fn();
  });
  vi.mocked(readServiceStatusDetails).mockResolvedValue({
    kind: "unreachable",
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(MEASUREMENT)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ invalid: true }))),
  );
  vi.spyOn(Date, "now").mockReturnValue(20_000);
  const { result } = renderHook(() => useSystemDashboard());
  if (!poll) throw new Error("Polling did not start");
  const read = poll;
  await act(async () => {
    await read(true);
  });
  expect(result.current.history.processor).toEqual([
    { at: 20_000, ratio: null },
    { at: 20_000, ratio: 0.5 },
  ]);
  await act(async () => {
    await read(false);
  });
  expect(result.current.dashboard).toEqual(MEASUREMENT);
});
