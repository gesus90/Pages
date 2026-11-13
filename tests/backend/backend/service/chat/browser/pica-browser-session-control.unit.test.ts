import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logCaughtError } from "@/backend/logging/Logger";
import { PICA_BROWSER_PRESETS } from "@/backend/service/chat/browser/PicaBrowserSession";

import {
  createWorld,
  file,
  proxyHost,
  startWorld,
} from "./pica-browser-session-world";
import { proxies, resetProxies } from "./pica-browser-session-proxy";

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

describe("start and context", () => {
  it("opens a desktop context without touch, downloads or service workers and adopts the first tab", async () => {
    const storage = { cookies: [], origins: [] };
    const world = createWorld();
    await world.session.start(storage);
    const context = world.contexts[0];

    const options = world.browser.newContext.mock.calls[0][0];
    expect(options).toMatchObject({
      viewport: PICA_BROWSER_PRESETS.desktop,
      isMobile: false,
      hasTouch: false,
      acceptDownloads: false,
      serviceWorkers: "block",
      permissions: [],
      locale: "en-US",
      storageState: storage,
    });
    expect(options.userAgent).toContain("X11; Linux");
    expect(context.setDefaultTimeout).toHaveBeenCalledWith(8000);
    expect(context.setDefaultNavigationTimeout).toHaveBeenCalledWith(20_000);
    expect(world.session.openPages()).toEqual([context.pages[0]]);
    expect(world.session.activePage()).toBe(context.pages[0]);
    expect(world.session.requireContext()).toBe(context);
  });

  it("uses the mobile preset and omits storage state when none is given", async () => {
    const world = createWorld({ device: "mobile" });
    await world.session.start();

    const options = world.browser.newContext.mock.calls[0][0];
    expect(options).toMatchObject({
      viewport: PICA_BROWSER_PRESETS.mobile,
      isMobile: true,
      hasTouch: true,
    });
    expect(options.userAgent).toContain("Pixel 8");
    expect(options).not.toHaveProperty("storageState");
    expect(world.session.currentDevice).toBe("mobile");
    expect(world.session.view()).toMatchObject({ width: 390, height: 844 });
  });

  it("closes page websockets and routes every request through the proxy", async () => {
    const { context } = await startWorld();
    const socket = { close: vi.fn() };
    const socketHandler = context.routeWebSocket.mock.calls[0] as unknown[];
    expect(socketHandler[0]).toBe("**/*");
    (socketHandler[1] as (socket: unknown) => void)(socket);
    expect(socket.close).toHaveBeenCalledOnce();

    const routeCall = context.route.mock.calls[0] as unknown[];
    expect(routeCall[0]).toBe("**/*");
    const route = { id: "route" };
    proxies.handle.mockReturnValue("handled");
    expect((routeCall[1] as (route: unknown) => unknown)(route)).toBe(
      "handled",
    );
    expect(proxies.handle).toHaveBeenCalledWith(route);
  });

  it("refuses to hand out a context or tab before start and after close", async () => {
    const world = createWorld();
    expect(() => world.session.requireContext()).toThrow("BROWSER_CLOSED");
    expect(() => world.session.activePage()).toThrow("BROWSER_CLOSED");

    await world.session.start();
    await world.session.close();
    expect(() => world.session.requireContext()).toThrow("BROWSER_CLOSED");
  });

  it("reports a closed browser when the context has no tab left", async () => {
    const { session, page } = await startWorld();
    await page.close();

    expect(session.openPages()).toEqual([]);
    expect(() => session.activePage()).toThrow("BROWSER_CLOSED");
  });

  it("exposes the allowed origins, ids and server-owned facts", async () => {
    const { session } = await startWorld({ profile: "work" });

    expect(session.allowedOrigins()).toEqual({
      pages: ["https://pages.test"],
      services: [],
    });
    expect(session.userId).toBe("user-1");
    expect(session.scope).toBe("scope-1");
    expect(session.conversationId).toBe("conversation-1");
    expect(session.task).toBe("Check the dashboard");
    expect(session.profile).toBe("work");
    expect(session.referenceKey).toMatch(/^__pica_[0-9a-f]{18}$/u);
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(session.currentState).toBe("running");
  });
});

describe("proxy host", () => {
  it("lets the page write locally only after approval or while the administrator drives", async () => {
    const { session } = await startWorld();
    const host = proxyHost();

    expect(host.areWritesApproved()).toBe(false);
    session.areLocalWritesApproved = true;
    expect(host.areWritesApproved()).toBe(true);
    session.areLocalWritesApproved = false;
    session.takeOver();
    expect(host.areWritesApproved()).toBe(true);
  });

  it("passes the job authorization, the lifetime signal and the origins on", async () => {
    const { session, authorize } = await startWorld();
    const host = proxyHost();

    await host.authorize();
    expect(authorize).toHaveBeenCalledOnce();
    expect(host.signal).toBe(session.signal);
    expect(host.origins()).toEqual({
      pages: ["https://pages.test"],
      services: [],
    });
  });

  it("turns proxy notes and captured files into notes and downloads", async () => {
    const { session } = await startWorld();
    const host = proxyHost();

    host.note("Blocked a request");
    host.capture(file("report.pdf", 12));

    expect(session.takeNotes()).toEqual([
      "Blocked a request",
      'Downloaded "report.pdf" (12 bytes).',
    ]);
    expect(session.storedDownloads()).toHaveLength(1);
  });

  it("returns the refusal of the proxy once and nothing without a proxy", async () => {
    const world = createWorld();
    expect(world.session.takeRefusal()).toBeNull();

    await world.session.start();
    proxies.refusal = "target not allowed";
    expect(world.session.takeRefusal()).toBe("target not allowed");
    expect(world.session.takeRefusal()).toBeNull();
  });
});

describe("control state", () => {
  it("moves between running, paused and takeover and logs each change", async () => {
    const { session } = await startWorld();

    session.resume();
    expect(session.currentState).toBe("running");
    session.handBack();
    expect(session.currentState).toBe("running");

    session.pause();
    expect(session.currentState).toBe("paused");
    session.pause();
    session.takeOver();
    expect(session.currentState).toBe("takeover");
    session.pause();
    session.takeOver();
    expect(session.currentState).toBe("takeover");
    session.handBack();
    expect(session.currentState).toBe("running");
    session.pause();
    session.resume();

    expect(session.view().actions.map((entry) => entry.summary)).toEqual([
      "Paused",
      "Took over the browser",
      "Handed the browser back to Pica",
      "Paused",
      "Resumed",
    ]);
    expect(
      session.view().actions.every((entry) => entry.actor === "admin"),
    ).toBe(true);
  });

  it("clears the handover reason when control returns to Pica", async () => {
    const { session } = await startWorld();

    session.requestHandover("Please sign in   to \n the portal");
    expect(session.currentState).toBe("takeover");
    expect(session.handoverReason).toBe("Please sign in to the portal");
    expect(session.view().handoverReason).toBe("Please sign in to the portal");
    expect(session.view().actions[0]).toMatchObject({
      actor: "pica",
      status: "completed",
      summary:
        "Asked the administrator to take over: Please sign in to the portal",
    });

    session.handBack();
    expect(session.handoverReason).toBeNull();
  });

  it("shortens long handover reasons to three hundred characters", async () => {
    const { session } = await startWorld();

    session.requestHandover("x".repeat(400));

    expect(session.handoverReason).toHaveLength(300);
    expect(session.handoverReason).toMatch(/…$/u);
  });

  it("keeps a stopped browser stopped when a handover is requested", async () => {
    const { session } = await startWorld();
    await session.stop();

    session.requestHandover("late");

    expect(session.currentState).toBe("stopped");
  });

  it("stops once: logs, closes the browser and ignores a second stop", async () => {
    const { session, browser, page } = await startWorld();
    page.address = "https://pages.test/final";
    session.requestHandover("sign in");

    await session.stop();
    await session.stop();

    expect(session.currentState).toBe("stopped");
    expect(session.handoverReason).toBeNull();
    expect(browser.close).toHaveBeenCalledOnce();
    expect(session.signal.aborted).toBe(true);
    const summaries = session.view().actions.map((entry) => entry.summary);
    expect(summaries.filter((text) => text === "Stopped the browser")).toEqual([
      "Stopped the browser",
    ]);
  });
});

describe("admit", () => {
  it("admits a running session and marks activity", async () => {
    vi.useFakeTimers();
    const { session } = await startWorld();
    vi.advanceTimersByTime(5000);
    expect(session.idleFor()).toBe(5000);

    await session.admit(new AbortController().signal);

    expect(session.idleFor()).toBe(0);
  });

  it("touches the activity clock on demand", async () => {
    vi.useFakeTimers();
    const { session } = await startWorld();
    vi.advanceTimersByTime(1000);

    session.touch();

    expect(session.idleFor()).toBe(0);
  });

  it("continues when the administrator resumes within the wait", async () => {
    vi.useFakeTimers();
    const { session } = await startWorld();
    session.pause();

    const admitted = session.admit(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(600);
    session.resume();
    await vi.advanceTimersByTimeAsync(200);

    await expect(admitted).resolves.toBeUndefined();
  });

  it("reports a pause that lasts past the deadline", async () => {
    vi.useFakeTimers();
    const { session } = await startWorld();
    session.pause();

    const admitted = session.admit(new AbortController().signal);
    const outcome = expect(admitted).rejects.toThrow("PAUSED_BY_ADMIN");
    await vi.advanceTimersByTimeAsync(21_000);

    await outcome;
  });

  it("reports an administrator takeover that lasts past the deadline", async () => {
    vi.useFakeTimers();
    const { session } = await startWorld();
    session.takeOver();

    const admitted = session.admit(new AbortController().signal);
    const outcome = expect(admitted).rejects.toThrow("ADMIN_HAS_CONTROL");
    await vi.advanceTimersByTimeAsync(21_000);

    await outcome;
  });

  it("fails at once when the browser was stopped", async () => {
    const { session } = await startWorld();
    await session.stop();

    await expect(session.admit(new AbortController().signal)).rejects.toThrow(
      "STOPPED_BY_ADMIN",
    );
  });

  it("stops waiting when the calling job is aborted", async () => {
    vi.useFakeTimers();
    const { session } = await startWorld();
    session.pause();
    const job = new AbortController();

    const admitted = session.admit(job.signal);
    const outcome = expect(admitted).rejects.toThrow("cancelled");
    job.abort(new Error("cancelled"));
    await vi.advanceTimersByTimeAsync(300);

    await outcome;
  });

  it("refuses a running session whose context is gone", async () => {
    const world = createWorld();

    await expect(
      world.session.admit(new AbortController().signal),
    ).rejects.toThrow("BROWSER_CLOSED");
  });
});

describe("action log and notes", () => {
  it("keeps the newest sixty entries and shortens each summary", async () => {
    const { session } = await startWorld();

    for (let index = 0; index < 65; index += 1)
      session.record("pica", `step ${index}`, "completed");
    session.record("pica", "y".repeat(500), "failed");

    const { actions } = session.view();
    expect(actions).toHaveLength(60);
    expect(actions[0].summary).toBe("step 6");
    expect(actions[59]).toMatchObject({ status: "failed" });
    expect(actions[59].summary).toHaveLength(300);
    expect(Number.isNaN(Date.parse(actions[0].at))).toBe(false);
  });

  it("collapses duplicate notes, keeps twelve and clears them when read", async () => {
    const { session } = await startWorld();

    session.note("same");
    session.note("same");
    for (let index = 0; index < 13; index += 1) session.note(`note ${index}`);
    const notes = session.takeNotes();

    expect(notes).toHaveLength(12);
    expect(notes[0]).toBe("note 1");
    expect(notes).not.toContain("same");
    expect(session.takeNotes()).toEqual([]);
  });

  it("shortens long notes to two hundred characters", async () => {
    const { session } = await startWorld();

    session.note("z".repeat(300));

    const [note] = session.takeNotes();
    expect(note).toHaveLength(200);
    expect(note.endsWith("…")).toBe(true);
  });
});

describe("live picture", () => {
  it("versions stored frames and lets one capture run at a time", async () => {
    const { session } = await startWorld();
    expect(session.currentFrame()).toBeNull();
    expect(session.view().frameVersion).toBe(0);

    const first = session.storeFrame(Buffer.from("a"));
    const second = session.storeFrame(Buffer.from("b"));

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(session.currentFrame()).toMatchObject({ version: 2 });
    expect(session.currentFrame()?.bytes.toString()).toBe("b");
    expect(session.view().frameVersion).toBe(2);

    expect(session.beginCapture()).toBe(true);
    expect(session.beginCapture()).toBe(false);
    session.endCapture();
    expect(session.beginCapture()).toBe(true);
  });
});

describe("downloads", () => {
  it("keeps a download, notes it and lists it in the view without its bytes", async () => {
    const { session } = await startWorld();

    session.keepDownload(file("report.pdf", 1234));

    const [stored] = session.storedDownloads();
    expect(stored).toMatchObject({
      fileName: "report.pdf",
      contentType: "application/pdf",
      size: 1234,
    });
    expect(stored.bytes).toHaveLength(1234);
    expect(session.takeNotes()).toEqual([
      'Downloaded "report.pdf" (1234 bytes).',
    ]);
    const [listed] = session.view().downloads;
    expect(listed).toEqual({
      id: stored.id,
      fileName: "report.pdf",
      contentType: "application/pdf",
      size: 1234,
      at: stored.at,
    });
  });

  it("refuses a file above twenty-five megabytes", async () => {
    const { session } = await startWorld();

    session.keepDownload(file("huge.bin", 25 * 1024 * 1024 + 1));

    expect(session.storedDownloads()).toEqual([]);
    expect(session.takeNotes()).toEqual([
      'Download "huge.bin" was refused: too large.',
    ]);
  });

  it("accepts a file of exactly twenty-five megabytes", async () => {
    const { session } = await startWorld();

    session.keepDownload(file("limit.bin", 25 * 1024 * 1024));

    expect(session.storedDownloads()).toHaveLength(1);
  });

  it("refuses a file that would pass the hundred megabyte budget", async () => {
    const { session } = await startWorld();
    for (let index = 0; index < 4; index += 1)
      session.keepDownload(file(`part-${index}`, 25 * 1024 * 1024));
    session.takeNotes();

    session.keepDownload(file("one-more", 1));

    expect(session.storedDownloads()).toHaveLength(4);
    expect(session.takeNotes()).toEqual([
      'Download "one-more" was refused: too large.',
    ]);
  });

  it("refuses the twenty-first download", async () => {
    const { session } = await startWorld();
    for (let index = 0; index < 20; index += 1)
      session.keepDownload(file(`file-${index}`, 1));
    session.takeNotes();

    session.keepDownload(file("extra", 1));

    expect(session.storedDownloads()).toHaveLength(20);
    expect(session.takeNotes()).toEqual([
      'Download "extra" was refused: too large.',
    ]);
  });
});

it("discards downloads in an agent browser and exposes only its own-account live facts", async () => {
  const { session } = await startWorld({
    isAgent: true,
    ownerName: "Bakuman",
  });
  session.keepDownload(file("report.pdf", 1234));
  expect(session.storedDownloads()).toEqual([]);
  expect(session.view()).toMatchObject({
    isAgent: true,
    ownerName: "Bakuman",
    downloads: [],
  });
  expect(session.takeNotes()).toContain(
    "Downloads are disabled for agent browsers.",
  );
  await session.close();
});
