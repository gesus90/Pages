import { expect, it, vi } from "vitest";

import {
  browserFailure,
  changeViewport,
  manageTabs,
  navigate,
  waitForPage,
} from "@/backend/service/chat/browser/PicaBrowserNavigation";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { PicaBrowserSession } from "@/backend/service/chat/browser/PicaBrowserSession";

type Page = ReturnType<PicaBrowserSession["activePage"]>;

vi.mock("@/backend/service/chat/browser/PicaBrowserObservation", () => ({
  settlePage: vi.fn(async () => undefined),
}));

it.each([
  ["net::ERR_CONNECTION_RESET", "NAVIGATION_FAILED"],
  ["Target closed", "BROWSER_CLOSED"],
  ["element is not visible", "ELEMENT_NOT_ACTIONABLE"],
  ["Unknown key", "INVALID_KEYS"],
  ["other", "BROWSER_ACTION_FAILED"],
])("classifies browser failure without exposing details", (message, code) => {
  const session = partial<PicaBrowserSession>({
    currentState: "running",
    takeRefusal: () => null,
  });
  expect(browserFailure(session, new Error(message)).message).toBe(code);
});

it("recognizes administrator stop, policy refusal and timeout", () => {
  expect(
    browserFailure(
      partial<PicaBrowserSession>({ currentState: "stopped" }),
      new Error("x"),
    ),
  ).toMatchObject({ message: "STOPPED_BY_ADMIN" });
  expect(
    browserFailure(
      partial<PicaBrowserSession>({
        currentState: "running",
        takeRefusal: () => "URL_DENIED",
      }),
      new Error("x"),
    ),
  ).toMatchObject({ message: "URL_DENIED" });
  const error = new Error("late");
  error.name = "TimeoutError";
  expect(
    browserFailure(
      partial<PicaBrowserSession>({
        currentState: "running",
        takeRefusal: () => null,
      }),
      error,
    ),
  ).toMatchObject({ message: "ACTION_TIMEOUT" });
});

it("navigates history and waits through an in-memory page boundary", async () => {
  const goBack = vi.fn(async () => null);
  const waitForTimeout = vi.fn(async () => undefined);
  const waitFor = vi.fn(async () => undefined);
  const page = partial<Page>({
    goBack,
    waitForTimeout,
    getByText: () => ({ first: () => ({ waitFor }) }),
  });
  const session = partial<PicaBrowserSession>({ activePage: () => page });
  await expect(
    navigate(session, {
      browserId: "00000000-0000-4000-8000-000000000001",
      action: "back",
    }),
  ).resolves.toBe("Went back");
  await expect(
    waitForPage(session, {
      browserId: "00000000-0000-4000-8000-000000000001",
      seconds: 2,
    }),
  ).resolves.toBe("Waited 2 s");
  await expect(
    waitForPage(session, {
      browserId: "00000000-0000-4000-8000-000000000001",
      text: "ready",
    }),
  ).resolves.toBe("Waited for text to appear");
  expect(goBack).toHaveBeenCalled();
  expect(waitForTimeout).toHaveBeenCalledWith(2000);
  expect(waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 10000 });
});

it("switches and closes tabs, and resizes a viewport", async () => {
  const bringToFront = vi.fn(async () => undefined);
  const close = vi.fn(async () => undefined);
  const page = partial<Page>({ bringToFront, close });
  const resize = vi.fn(async () => undefined);
  const session = partial<PicaBrowserSession>({
    activePage: () => page,
    activate: () => page,
    openPages: () => [page, page],
    resize,
    currentDevice: "desktop",
  });
  await expect(
    manageTabs(session, {
      browserId: "00000000-0000-4000-8000-000000000001",
      action: "switch",
      tab: 1,
    }),
  ).resolves.toBe("Switched to tab 1");
  await expect(
    manageTabs(session, {
      browserId: "00000000-0000-4000-8000-000000000001",
      action: "close",
      tab: 0,
    }),
  ).resolves.toBe("Closed tab 0");
  await expect(
    changeViewport(session, {
      browserId: "00000000-0000-4000-8000-000000000001",
      width: 800,
      height: 600,
    }),
  ).resolves.toBe("Resized to 800x600");
  expect(bringToFront).toHaveBeenCalled();
  expect(close).toHaveBeenCalled();
  expect(resize).toHaveBeenCalledWith(800, 600);
});
