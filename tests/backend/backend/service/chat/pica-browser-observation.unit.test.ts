import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { PicaBrowserSession } from "@/backend/service/chat/browser/PicaBrowserSession";

import {
  captureLiveFrame,
  observePage,
} from "@/backend/service/chat/browser/PicaBrowserObservation";

const facts = {
  url: "https://example.com/page",
  title: "Page",
  viewport: { width: 800, height: 600 },
  scroll: { x: 0, y: 0, maxX: 0, maxY: 100 },
  total: 2,
  frames: 1,
  elements: [{ ref: "e1", role: "button", name: "Save", box: [0, 0, 10, 10] }],
  text: "Page text",
};
const screenshot = vi.fn();
const evaluate = vi.fn();
const aria = vi.fn();
const waitForLoadState = vi.fn();
const waitForTimeout = vi.fn();
const page = {
  screenshot,
  evaluate,
  viewportSize: () => ({ width: 800, height: 600 }),
  locator: () => ({ ariaSnapshot: aria }),
  waitForLoadState,
  waitForTimeout,
};
const sensitivePages = new Set();
const elementNames = new Map();
const session = partial<PicaBrowserSession>({
  id: "browser",
  referenceKey: "key",
  currentState: "running",
  currentDevice: "desktop",
  activePage: () => page,
  sensitivePages,
  elementNames,
  shots: { run: async (work: () => Promise<unknown>) => work() },
  tabList: () => [{ isActive: true }],
  takeNotes: () => [],
});

beforeEach(() => {
  vi.resetAllMocks();
  sensitivePages.clear();
  elementNames.clear();
  evaluate.mockResolvedValue(facts);
  screenshot.mockResolvedValue(Buffer.from("jpeg"));
  aria.mockResolvedValue("accessible tree");
  waitForLoadState.mockResolvedValue(undefined);
  waitForTimeout.mockResolvedValue(undefined);
});

it("returns bounded observations and a masked screenshot from a simulated page", async () => {
  const result = await observePage(session, { detail: "full", fullPage: true });
  expect(JSON.parse(result.text)).toMatchObject({
    title: "Page",
    text: "Page text",
    aria: "accessible tree",
    moreElements: 1,
    frames: 1,
  });
  expect(result.images).toEqual([
    { mimeType: "image/jpeg", data: Buffer.from("jpeg").toString("base64") },
  ]);
  expect(elementNames.get("e1")).toBe('button "Save"');
  expect(screenshot).toHaveBeenCalledWith(
    expect.objectContaining({
      clip: { x: 0, y: 0, width: 800, height: 700 },
    }),
  );
});

it("withholds accessibility content after an administrator types", async () => {
  sensitivePages.add(page);
  const result = await observePage(session, { detail: "full" });
  expect(JSON.parse(result.text)).toHaveProperty("privacy");
  expect(aria).not.toHaveBeenCalled();
  expect(screenshot.mock.calls[0][0].mask).toHaveLength(2);
});

it("retries a lost execution context and cleans up annotations", async () => {
  evaluate
    .mockRejectedValueOnce(new Error("Execution context was destroyed"))
    .mockResolvedValue(facts);
  const result = await observePage(session, {
    detail: "screen",
    annotate: true,
  });
  expect(JSON.parse(result.text)).not.toHaveProperty("text");
  expect(waitForLoadState).toHaveBeenCalledOnce();
  expect(evaluate).toHaveBeenCalledTimes(4);
});

it("reports screenshot failures and treats live frame errors as unavailable", async () => {
  screenshot.mockRejectedValue(new Error("failed"));
  await expect(observePage(session, { detail: "brief" })).rejects.toThrow();
  expect(await captureLiveFrame(session)).toBeNull();
  screenshot.mockResolvedValue(Buffer.from("jpeg"));
  expect(await captureLiveFrame(session)).toEqual(Buffer.from("jpeg"));
});
