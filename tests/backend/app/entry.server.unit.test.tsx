import { afterEach, beforeEach, expect, it, vi } from "vitest";

import handleRequest, { handleError, streamTimeout } from "@/app/entry.server";

import type { PassThrough } from "node:stream";
import type { EntryContext } from "react-router";
import type { RenderToPipeableStreamOptions } from "react-dom/server";

const renderer = vi.hoisted(() => ({
  options: undefined as RenderToPipeableStreamOptions | undefined,
  pipe: vi.fn(),
  abort: vi.fn(),
}));
const logging = vi.hoisted(() => ({ logEvent: vi.fn() }));

vi.mock("react-dom/server", () => ({
  renderToPipeableStream: (
    ...[, options]: [unknown, RenderToPipeableStreamOptions]
  ) => {
    renderer.options = options;
    return { pipe: renderer.pipe, abort: renderer.abort };
  },
}));
vi.mock("react-router", () => ({ ServerRouter: () => null }));
vi.mock("@/backend/logging/Logger", () => ({ logEvent: logging.logEvent }));

const BROWSER = "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0";
const CRAWLER = "Mozilla/5.0 (compatible; Googlebot/2.1)";

/** A page request; only the method and the user agent steer the renderer. */
function pageRequest(userAgent: string, method = "GET"): Request {
  return new Request("https://pages.example.com/projects", {
    method,
    headers: { "user-agent": userAgent },
  });
}

/** Only the SPA flag matters to the renderer; the router itself is a stub. */
function routerContext(isSpaMode = false): EntryContext {
  const partial = { isSpaMode };
  return partial as unknown as EntryContext;
}

/** The option the renderer was given, so a test can fire the React callback. */
/** The options of the latest render; read through a function so narrowing never hides a later assignment. */
function renderOptions(): RenderToPipeableStreamOptions | undefined {
  return renderer.options;
}

function reactCallback(
  name: "onShellReady" | "onAllReady" | "onShellError" | "onError",
): (error?: unknown) => void {
  const callback = renderer.options?.[name];
  if (!callback) throw new Error(`The renderer has no ${name} callback.`);
  return callback as (error?: unknown) => void;
}

beforeEach(() => {
  vi.useFakeTimers();
  renderer.options = undefined;
  renderer.pipe.mockImplementation((body: PassThrough) => body.end("<html>"));
});

afterEach(() => {
  vi.useRealTimers();
});

it("logs a server error centrally without a message for the client", () => {
  const failure = new Error("boom");

  handleError(failure);

  expect(logging.logEvent).toHaveBeenCalledWith({
    level: "error",
    event: "http.application.failed",
    component: "ServerRendering",
    message: "Application request failed",
    error: failure,
  });
});

it("answers a HEAD request with the headers only and renders nothing", async () => {
  const headers = new Headers({ "x-frame-options": "DENY" });

  const response = await handleRequest(
    pageRequest(BROWSER, "HEAD"),
    204,
    headers,
    routerContext(),
  );

  expect(response.status).toBe(204);
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(await response.text()).toBe("");
  expect(renderOptions()).toBeUndefined();
});

it("streams the shell to a browser as HTML as soon as it is ready", async () => {
  const headers = new Headers();
  const pending = handleRequest(
    pageRequest(BROWSER),
    200,
    headers,
    routerContext(),
  );

  expect(renderOptions()?.onShellReady).toBeDefined();
  expect(renderOptions()?.onAllReady).toBeUndefined();
  reactCallback("onShellReady")();
  const response = await pending;

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/html");
  expect(await response.text()).toBe("<html>");
  expect(renderer.pipe).toHaveBeenCalledOnce();
});

it("waits for the complete page for crawlers and for SPA mode", async () => {
  for (const [agent, isSpaMode] of [
    [CRAWLER, false],
    [BROWSER, true],
  ] as const) {
    renderer.options = undefined;
    const pending = handleRequest(
      pageRequest(agent),
      200,
      new Headers(),
      routerContext(isSpaMode),
    );

    expect(renderOptions()?.onShellReady).toBeUndefined();
    reactCallback("onAllReady")();
    expect((await pending).status).toBe(200);
  }
});

it("renders a request without a user agent as a browser", async () => {
  const request = new Request("https://pages.example.com/");
  const pending = handleRequest(request, 200, new Headers(), routerContext());

  reactCallback("onShellReady")();

  expect((await pending).status).toBe(200);
  expect(renderOptions()?.onAllReady).toBeUndefined();
});

it("rejects when the shell cannot be rendered and never aborts afterwards", async () => {
  const failure = new Error("shell");
  const pending = handleRequest(
    pageRequest(BROWSER),
    200,
    new Headers(),
    routerContext(),
  );

  reactCallback("onShellError")(failure);
  await expect(pending).rejects.toBe(failure);
  vi.advanceTimersByTime(streamTimeout + 1_000);

  expect(renderer.abort).not.toHaveBeenCalled();
});

it("answers 500 for an error before the shell and logs one after it", async () => {
  const early = handleRequest(
    pageRequest(BROWSER),
    200,
    new Headers(),
    routerContext(),
  );
  reactCallback("onError")(new Error("before the shell"));
  reactCallback("onShellReady")();

  expect((await early).status).toBe(500);
  expect(logging.logEvent).not.toHaveBeenCalled();

  const late = handleRequest(
    pageRequest(BROWSER),
    200,
    new Headers(),
    routerContext(),
  );
  reactCallback("onShellReady")();
  const lateFailure = new Error("while streaming");
  reactCallback("onError")(lateFailure);

  expect((await late).status).toBe(200);
  expect(logging.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({ error: lateFailure }),
  );
});

it("aborts a render that outlasts the stream timeout", () => {
  void handleRequest(pageRequest(BROWSER), 200, new Headers(), routerContext());

  vi.advanceTimersByTime(streamTimeout + 999);
  expect(renderer.abort).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);

  expect(renderer.abort).toHaveBeenCalledOnce();
});

it("stops the abort timer once the response body has ended", async () => {
  const pending = handleRequest(
    pageRequest(BROWSER),
    200,
    new Headers(),
    routerContext(),
  );
  reactCallback("onShellReady")();
  const response = await pending;
  await response.text();
  vi.advanceTimersByTime(streamTimeout + 1_000);

  expect(renderer.abort).not.toHaveBeenCalled();
});
