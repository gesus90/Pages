import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logCaughtError } from "@/backend/logging/Logger";
import { PICA_BROWSER_PRESETS } from "@/backend/service/chat/browser/PicaBrowserSession";

import {
  FakePage,
  createWorld,
  fakeDialog,
  file,
  startWorld,
} from "./pica-browser-session-world";
import { resetProxies } from "./pica-browser-session-proxy";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));
vi.mock("@/backend/service/chat/browser/PicaBrowserProxy", async () => {
  const proxy = await import("./pica-browser-session-proxy");
  return proxy.createProxyModule();
});

beforeEach(() => {
  resetProxies();
  vi.mocked(logCaughtError).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("tabs and titles", () => {
  it("lists tabs with shortened addresses and known titles", async () => {
    const { session, page, context } = await startWorld();
    page.address = `https://pages.test/${"p".repeat(400)}`;
    const popup = context.popup();
    popup.address = "https://pages.test/second";

    await session.refreshTitles();
    const tabs = session.tabList();

    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toMatchObject({
      index: 0,
      isActive: false,
      title: "Title",
    });
    expect(tabs[0].url).toHaveLength(300);
    expect(tabs[1]).toEqual({
      index: 1,
      url: "https://pages.test/second",
      title: "Title",
      isActive: true,
    });
  });

  it("keeps the last title of a busy tab and logs a failing one", async () => {
    vi.useFakeTimers();
    const { session, page, context } = await startWorld();
    await session.refreshTitles();
    const slow = context.popup();
    slow.title.mockReturnValue(new Promise(() => undefined));
    const broken = context.popup();
    const failure = new Error("page crashed");
    broken.title.mockRejectedValue(failure);
    page.title.mockReturnValue(new Promise(() => undefined));

    const refreshed = session.refreshTitles();
    await vi.advanceTimersByTimeAsync(600);
    await refreshed;

    const titles = session.tabList().map((tab) => tab.title);
    expect(titles).toEqual(["Title", "", ""]);
    expect(logCaughtError).toHaveBeenCalledWith("PicaBrowserSession", failure);
  });

  it("shows the active tab in the view and falls back to the first tab", async () => {
    const { session, page, context } = await startWorld();
    page.address = "https://pages.test/one";
    const popup = context.popup();
    popup.address = "https://pages.test/two";
    await session.refreshTitles();

    expect(session.view()).toMatchObject({
      browserId: session.id,
      task: "Check the dashboard",
      state: "running",
      url: "https://pages.test/two",
      title: "Title",
      device: "desktop",
      width: 1280,
      height: 800,
      profile: null,
      areLocalWritesApproved: false,
    });

    popup.close.mockClear();
    session.activate(0);
    expect(session.view().url).toBe("https://pages.test/one");
  });

  it("activates an existing tab and refuses an unknown index", async () => {
    const { session, page, context } = await startWorld();
    context.popup();

    expect(session.activate(0)).toBe(page);
    expect(session.activePage()).toBe(page);
    expect(() => session.activate(5)).toThrow("TAB_NOT_FOUND");
    expect(session.activePage()).toBe(page);
  });

  it("shortens task and address in the view", async () => {
    const { session, page } = await startWorld({ task: "t".repeat(700) });
    page.address = `https://pages.test/${"a".repeat(700)}`;

    const view = session.view();

    expect(view.task).toHaveLength(500);
    expect(view.url).toHaveLength(500);
  });

  it("resizes the active tab and the reported size", async () => {
    const { session, page } = await startWorld();

    await session.resize(800, 600);

    expect(page.setViewportSize).toHaveBeenCalledWith({
      width: 800,
      height: 600,
    });
    expect(session.view()).toMatchObject({ width: 800, height: 600 });
  });

  it("reads the storage state of the context", async () => {
    const { session, context } = await startWorld();
    const state = { cookies: [], origins: [{ origin: "x", localStorage: [] }] };
    context.storageState.mockResolvedValueOnce(state);

    await expect(session.storage()).resolves.toBe(state);
  });
});

describe("tab adoption", () => {
  it("makes a popup the active tab and says so", async () => {
    const { session, context } = await startWorld();

    const popup = context.popup();

    expect(session.activePage()).toBe(popup);
    expect(session.takeNotes()).toEqual(["A new tab opened (tab 1)."]);
  });

  it("closes tabs beyond eight and notes it", async () => {
    const { session, context } = await startWorld();
    for (let index = 0; index < 7; index += 1) context.popup();
    session.takeNotes();

    const ninth = context.popup();

    expect(session.openPages()).toHaveLength(8);
    expect(session.openPages()).not.toContain(ninth);
    expect(ninth.close).toHaveBeenCalledOnce();
    expect(session.takeNotes()).toEqual([
      "A new tab was closed: too many tabs are open.",
    ]);
  });

  it("swallows a failing close of a surplus tab", async () => {
    const { context } = await startWorld();
    for (let index = 0; index < 7; index += 1) context.popup();
    const extra = new FakePage();
    extra.close.mockRejectedValue(new Error("already gone"));

    expect(() => context.emit("page", extra)).not.toThrow();
    await Promise.resolve();
  });

  it("adopts a page once even when it is announced twice", async () => {
    const { session, context, page } = await startWorld();

    context.emit("page", page);

    expect(session.openPages()).toEqual([page]);
    expect(session.takeNotes()).toEqual([]);
  });

  it("moves the active tab back when the active one closes", async () => {
    const { session, context, page } = await startWorld();
    const popup = context.popup();

    await popup.close();

    expect(session.openPages()).toEqual([page]);
    expect(session.activePage()).toBe(page);
  });

  it("keeps the active tab when an earlier tab closes and ignores a repeated close", async () => {
    const { session, context, page } = await startWorld();
    const popup = context.popup();

    await page.close();
    page.emit("close");

    expect(session.openPages()).toEqual([popup]);
    expect(session.activePage()).toBe(popup);
  });

  it("keeps the active index when a later tab closes", async () => {
    const { session, context, page } = await startWorld();
    context.popup();
    const last = context.popup();
    session.activate(0);

    await last.close();

    expect(session.openPages()).toHaveLength(2);
    expect(session.activePage()).toBe(page);
  });

  it("notes console errors and page errors but not other console output", async () => {
    const { session, page } = await startWorld();

    page.emit("console", { type: () => "log", text: () => "hello" });
    page.emit("console", { type: () => "error", text: () => "boom" });
    page.emit("pageerror", new Error("Uncaught TypeError"));

    expect(session.takeNotes()).toEqual([
      "Console error: boom",
      "Page error: Uncaught TypeError",
    ]);
  });

  it("forgets that a page was typed into once it loads", async () => {
    const { session, page } = await startWorld();
    session.sensitivePages.add(page as never);

    page.emit("load");

    expect(session.sensitivePages.has(page as never)).toBe(false);
  });

  it("notes failing main-frame navigations only", async () => {
    const { session, page } = await startWorld();
    const response = (
      status: number,
      isNavigation: boolean,
      frame: object,
      url = "https://pages.test/missing?x=1",
    ): object => ({
      request: () => ({ isNavigationRequest: () => isNavigation }),
      status: () => status,
      frame: () => frame,
      url: () => url,
    });

    page.emit("response", response(404, true, page.frame));
    page.emit("response", response(200, true, page.frame));
    page.emit("response", response(500, false, page.frame));
    page.emit("response", response(500, true, {}));

    expect(session.takeNotes()).toEqual(["HTTP 404 for pages.test/missing."]);
  });
});

describe("dialogs", () => {
  it("accepts alerts and beforeunload dialogs by default and notes them", async () => {
    const { session, page } = await startWorld();
    const alert = fakeDialog("alert", "Saved");
    const unload = fakeDialog("beforeunload", "");

    page.emit("dialog", alert);
    page.emit("dialog", unload);
    await Promise.resolve();

    expect(alert.accept).toHaveBeenCalledOnce();
    expect(unload.accept).toHaveBeenCalledOnce();
    expect(session.takeNotes()).toEqual([
      'A alert dialog "Saved" was accepted.',
      'A beforeunload dialog "" was accepted.',
    ]);
  });

  it("dismisses confirm and prompt dialogs by default", async () => {
    const { session, page } = await startWorld();
    const confirm = fakeDialog("confirm", "Delete?");
    const prompt = fakeDialog("prompt", "Name?");

    page.emit("dialog", confirm);
    page.emit("dialog", prompt);
    await Promise.resolve();

    expect(confirm.dismiss).toHaveBeenCalledOnce();
    expect(prompt.dismiss).toHaveBeenCalledOnce();
    expect(confirm.accept).not.toHaveBeenCalled();
    expect(session.takeNotes()).toEqual([
      'A confirm dialog "Delete?" was dismissed.',
      'A prompt dialog "Name?" was dismissed.',
    ]);
  });

  it("follows the answer the current action chose", async () => {
    const { session, page } = await startWorld();
    const confirm = fakeDialog("confirm", "Delete?");
    const alert = fakeDialog("alert", "Careful");

    session.dialogAnswer = "accept";
    page.emit("dialog", confirm);
    session.dialogAnswer = "dismiss";
    page.emit("dialog", alert);
    await Promise.resolve();

    expect(confirm.accept).toHaveBeenCalledOnce();
    expect(alert.dismiss).toHaveBeenCalledOnce();
    expect(session.takeNotes()).toEqual([
      'A confirm dialog "Delete?" was accepted.',
      'A alert dialog "Careful" was dismissed.',
    ]);
  });

  it("logs a dialog that cannot be answered", async () => {
    const { page } = await startWorld();
    const failure = new Error("dialog closed");
    const confirm = fakeDialog("confirm", "Delete?", failure);
    const alert = fakeDialog("alert", "Saved", failure);

    page.emit("dialog", confirm);
    page.emit("dialog", alert);
    await Promise.resolve();
    await Promise.resolve();

    expect(logCaughtError).toHaveBeenCalledTimes(2);
    expect(logCaughtError).toHaveBeenCalledWith("PicaBrowserSession", failure);
  });
});

describe("changeDevice", () => {
  it("restarts the context on the other preset with the same storage and returns the address", async () => {
    const { session, context, browser, page } = await startWorld();
    page.address = "https://pages.test/work";
    const storage = {
      cookies: [],
      origins: [{ origin: "https://pages.test", localStorage: [] }],
    };
    context.storageState.mockResolvedValueOnce(storage);
    context.popup();
    session.activate(0);

    const url = await session.changeDevice("mobile");

    expect(url).toBe("https://pages.test/work");
    expect(context.close).toHaveBeenCalledOnce();
    expect(browser.newContext).toHaveBeenCalledTimes(2);
    expect(browser.newContext.mock.calls[1][0]).toMatchObject({
      viewport: PICA_BROWSER_PRESETS.mobile,
      isMobile: true,
      storageState: storage,
    });
    expect(session.currentDevice).toBe("mobile");
    expect(session.view()).toMatchObject({ width: 390, height: 844 });
    expect(session.openPages()).toHaveLength(1);
    expect(session.activePage()).not.toBe(page);
    expect(session.requireContext()).not.toBe(context);
  });

  it("refuses to change the device of a closed browser", async () => {
    const { session } = await startWorld();
    await session.close();

    await expect(session.changeDevice("mobile")).rejects.toThrow(
      "BROWSER_CLOSED",
    );
  });
});

describe("close", () => {
  it("closes the browser once, aborts the signal and clears tabs and downloads", async () => {
    const { session, browser, page } = await startWorld();
    page.address = "https://pages.test/last";
    session.keepDownload(file("a.txt", 3));

    await session.close();
    await session.close();

    expect(browser.close).toHaveBeenCalledOnce();
    expect(session.signal.aborted).toBe(true);
    expect(session.currentState).toBe("stopped");
    expect(session.openPages()).toEqual([]);
    expect(session.storedDownloads()).toEqual([]);
    expect(session.view()).toMatchObject({
      url: "https://pages.test/last",
      title: "",
      state: "stopped",
    });
  });

  it("logs a browser that fails to close and still finishes", async () => {
    const { session, browser } = await startWorld();
    const failure = new Error("chromium gone");
    browser.close.mockRejectedValue(failure);

    await expect(session.close()).resolves.toBeUndefined();

    expect(logCaughtError).toHaveBeenCalledWith("PicaBrowserSession", failure);
    expect(session.openPages()).toEqual([]);
  });

  it("closes when the signal of the job ends", async () => {
    const { session, browser, job } = await startWorld();

    job.abort();
    await vi.waitFor(() => expect(browser.close).toHaveBeenCalledOnce());

    expect(session.signal.aborted).toBe(true);
    expect(session.currentState).toBe("stopped");
  });

  it("reports a closed session before start with the creation address", async () => {
    const world = createWorld();

    await world.session.close();

    expect(world.session.view()).toMatchObject({ url: "", title: "" });
  });
});
