import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  backendRedirect,
  backendRequestHeaders,
  DATA_REQUEST_HEADER,
  REDIRECT_HEADER,
  sendToBackend,
} from "@/app/lib/backend-request";

import type * as ReactRouter from "react-router";

const protocol = vi.hoisted(() => ({ decode: vi.fn() }));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  UNSAFE_decodeViaTurboStream: protocol.decode,
}));

const { UNSAFE_SingleFetchRedirectSymbol: REDIRECT_SYMBOL } =
  await import("react-router");

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  protocol.decode.mockReset();
});

/** Answers the next fetch with a body-carrying response and the decoded protocol value. */
function answerWith(value: unknown, init: ResponseInit = {}): void {
  fetchMock.mockResolvedValueOnce(
    new Response("encoded", {
      status: 200,
      headers: { "X-Remix-Response": "yes" },
      ...init,
    }),
  );
  protocol.decode.mockResolvedValueOnce({ value });
}

/** The thrown value of a failing call, so its kind can be asserted. */
async function thrownBy(request: Request): Promise<unknown> {
  try {
    await sendToBackend(request);
  } catch (error) {
    return error;
  }
  throw new Error("sendToBackend did not throw");
}

describe("backendRequestHeaders", () => {
  it("marks a request as a data request and keeps the caller's headers", () => {
    const headers = backendRequestHeaders({ Accept: "application/json" });

    expect(headers.get(DATA_REQUEST_HEADER)).toBe("1");
    expect(headers.get("Accept")).toBe("application/json");
  });

  it("works without caller headers", () => {
    expect(backendRequestHeaders().get(DATA_REQUEST_HEADER)).toBe("1");
  });
});

describe("backendRedirect", () => {
  it("turns the redirect header into a redirect of the app", () => {
    const response = backendRedirect(
      new Response(null, {
        status: 204,
        headers: { [REDIRECT_HEADER]: "/login?next=%2Fa" },
      }),
    );

    expect(response?.status).toBe(302);
    expect(response?.headers.get("Location")).toBe("/login?next=%2Fa");
  });

  it("follows where a proxy in between ended", () => {
    const answer = new Response("ok");
    Object.defineProperties(answer, {
      redirected: { value: true },
      url: { value: "https://pages.example/projects?tab=open#frag" },
    });

    expect(backendRedirect(answer)?.headers.get("Location")).toBe(
      "/projects?tab=open",
    );
  });

  it("answers null when nothing redirected", () => {
    expect(backendRedirect(new Response("ok"))).toBeNull();
  });
});

describe("sendToBackend request", () => {
  it("reads a loader from the .data address with only the content type, no body and no caching", async () => {
    answerWith({ "routes/a": { data: 1 } });
    const controller = new AbortController();

    await sendToBackend(
      new Request("https://pages.example/projects?x=1", {
        signal: controller.signal,
        headers: { "Content-Type": "text/plain", Cookie: "ignored=1" },
      }),
    );

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/projects.data");
    expect(url.search).toBe("?x=1");
    expect(init).toMatchObject({
      body: null,
      cache: "no-store",
      credentials: "same-origin",
      method: "GET",
    });
    const headers = init.headers as Headers;
    expect(headers.get("Content-Type")).toBe("text/plain");
    expect([...headers.keys()]).toEqual(["content-type"]);
  });

  it("addresses a trailing-slash path as _.data and sends no content type when there is none", async () => {
    answerWith({ "routes/a": { data: 1 } });

    await sendToBackend(new Request("https://pages.example/projects/"));

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/projects/_.data");
    expect([...(init.headers as Headers).keys()]).toEqual([]);
  });

  it("keeps only non-empty index parameters of a read", async () => {
    answerWith({ "routes/a": { data: 1 } });

    await sendToBackend(
      new Request("https://pages.example/p?index&index=1&q=2"),
    );

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.searchParams.getAll("index")).toEqual(["1"]);
    expect(url.searchParams.get("q")).toBe("2");
  });

  it("sends the body of a change and leaves the query alone", async () => {
    answerWith({ data: "done" });

    await sendToBackend(
      new Request("https://pages.example/p?index&index=1", {
        method: "POST",
        body: "a=1",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    );

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.search).toBe("?index&index=1");
    expect(init.method).toBe("POST");
    expect(await (init.body as Blob).text()).toBe("a=1");
  });

  it("lets a failed connection pass as the TypeError of fetch", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(
      sendToBackend(new Request("https://pages.example/p")),
    ).rejects.toThrow(TypeError);
  });
});

describe("sendToBackend answers", () => {
  it("returns the data of the last route answer of a read", async () => {
    answerWith({
      root: { notARouteResult: true },
      "routes/a": { data: "first" },
      "routes/b": { data: "last" },
    });

    await expect(
      sendToBackend(new Request("https://pages.example/p")),
    ).resolves.toBe("last");
  });

  it("returns the data of a change", async () => {
    answerWith({ data: { saved: true } });

    await expect(
      sendToBackend(new Request("https://pages.example/p", { method: "PUT" })),
    ).resolves.toEqual({ saved: true });
  });

  it("throws the error a route answered with", async () => {
    const error = new Error("route failed");
    answerWith({ "routes/a": { error } });

    expect(await thrownBy(new Request("https://pages.example/p"))).toBe(error);
  });

  it("refuses a read without any route result", async () => {
    answerWith({ root: "no result" });

    await expect(
      sendToBackend(new Request("https://pages.example/p")),
    ).rejects.toThrow("The API answered without a result.");
  });

  it("refuses a change whose answer is no route result", async () => {
    answerWith({ other: 1 });

    await expect(
      sendToBackend(new Request("https://pages.example/p", { method: "POST" })),
    ).rejects.toThrow("The API answered without a result.");
  });

  it("refuses an answer that is not an object", async () => {
    answerWith("text");

    await expect(
      sendToBackend(new Request("https://pages.example/p")),
    ).rejects.toThrow("The API answered in another form.");
  });

  it.each([204, 205, 304])(
    "answers null for a %i without body",
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        new Response(null, {
          status,
          headers: { "X-Remix-Response": "yes" },
        }),
      );

      await expect(
        sendToBackend(new Request("https://pages.example/p")),
      ).resolves.toBeNull();
      expect(protocol.decode).not.toHaveBeenCalled();
    },
  );

  it("answers null for a success without a body stream", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(
      sendToBackend(new Request("https://pages.example/p")),
    ).resolves.toBeNull();
  });
});

describe("sendToBackend errors and redirects", () => {
  it("throws an error response with status, text and body for a plain failure", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("no access", { status: 403, statusText: "Forbidden" }),
    );

    expect(
      await thrownBy(new Request("https://pages.example/p")),
    ).toMatchObject({
      status: 403,
      statusText: "Forbidden",
      data: "no access",
    });
  });

  it("decodes a failure that carries the data protocol marker", async () => {
    answerWith({ "routes/a": { data: "kept" } }, { status: 404 });

    await expect(
      sendToBackend(new Request("https://pages.example/p")),
    ).resolves.toBe("kept");
  });

  it("turns redirect headers into a redirect of the app with its flags", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 202,
        headers: {
          "X-Remix-Redirect": "/next",
          "X-Remix-Status": "303",
          "X-Remix-Revalidate": "true",
          "X-Remix-Reload-Document": "true",
          "X-Remix-Replace": "true",
        },
      }),
    );

    const thrown = (await thrownBy(
      new Request("https://pages.example/p"),
    )) as Response;

    expect(thrown.status).toBe(303);
    expect(thrown.headers.get("Location")).toBe("/next");
    expect(thrown.headers.get("X-Remix-Revalidate")).toBe("yes");
    expect(thrown.headers.get("X-Remix-Reload-Document")).toBe("yes");
    expect(thrown.headers.get("X-Remix-Replace")).toBe("yes");
  });

  it("defaults a redirect header to 302 without flags", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 202,
        headers: { "X-Remix-Redirect": "/plain" },
      }),
    );

    const thrown = (await thrownBy(
      new Request("https://pages.example/p"),
    )) as Response;

    expect(thrown.status).toBe(302);
    expect(thrown.headers.get("X-Remix-Revalidate")).toBeNull();
    expect(thrown.headers.get("X-Remix-Reload-Document")).toBeNull();
    expect(thrown.headers.get("X-Remix-Replace")).toBeNull();
  });

  it("turns a single-fetch redirect in the body into a redirect of the app", async () => {
    answerWith({
      [REDIRECT_SYMBOL]: {
        redirect: "/moved",
        status: 301,
        revalidate: true,
        reload: false,
        replace: true,
      },
    });

    const thrown = (await thrownBy(
      new Request("https://pages.example/p"),
    )) as Response;

    expect(thrown.status).toBe(301);
    expect(thrown.headers.get("Location")).toBe("/moved");
    expect(thrown.headers.get("X-Remix-Revalidate")).toBe("yes");
    expect(thrown.headers.get("X-Remix-Reload-Document")).toBeNull();
    expect(thrown.headers.get("X-Remix-Replace")).toBe("yes");
  });

  it("turns a redirect object that is the whole answer into a redirect", async () => {
    answerWith({
      redirect: "/whole",
      status: 302,
      revalidate: false,
      reload: false,
      replace: false,
    });

    const thrown = (await thrownBy(
      new Request("https://pages.example/p"),
    )) as Response;

    expect(thrown.headers.get("Location")).toBe("/whole");
  });
});
