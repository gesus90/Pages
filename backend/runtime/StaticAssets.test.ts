import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import path from "node:path";
import { PassThrough } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { refuseMissingAsset, serveStaticAsset } from "./StaticAssets";

interface FileStats {
  isFile: () => boolean;
  size: number;
}

const mocks = vi.hoisted(() => ({
  createReadStream: vi.fn(),
  stat: vi.fn<(filePath: string) => Promise<FileStats>>(),
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
  logFileProbeError: vi.fn(),
}));

vi.mock("node:fs", () => ({ createReadStream: mocks.createReadStream }));
vi.mock("node:fs/promises", () => ({ stat: mocks.stat }));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
  logEvent: mocks.logEvent,
  logFileProbeError: mocks.logFileProbeError,
}));

const CLIENT_DIRECTORY = "/srv/pages/build/client";

function createRequest(
  method: string,
  url: string | undefined,
): IncomingMessage {
  return Object.assign(new IncomingMessage(new Socket()), { method, url });
}

function createResponse(): ServerResponse {
  const response = new ServerResponse(new IncomingMessage(new Socket()));
  vi.spyOn(response, "writeHead").mockReturnValue(response);
  vi.spyOn(response, "end").mockReturnValue(response);
  vi.spyOn(response, "destroy").mockReturnValue(response);
  return response;
}

function regularFile(size: number): FileStats {
  return { isFile: () => true, size };
}

function sentHeaders(response: ServerResponse): Record<string, unknown> {
  const call = vi.mocked(response.writeHead).mock.calls[0];
  return Object.fromEntries(Object.entries(call?.[1] ?? {}));
}

beforeEach(() => {
  mocks.stat.mockResolvedValue(regularFile(12));
});

describe("serveStaticAsset requests that are left to the application", () => {
  it.each(["POST", "PUT", "DELETE", "OPTIONS"])(
    "does not answer %s requests",
    async (method) => {
      const response = createResponse();

      const served = await serveStaticAsset(
        createRequest(method, "/assets/app.js"),
        response,
        CLIENT_DIRECTORY,
      );

      expect(served).toBe(false);
      expect(mocks.stat).not.toHaveBeenCalled();
      expect(response.writeHead).not.toHaveBeenCalled();
    },
  );

  it("does not answer the app document", async () => {
    const served = await serveStaticAsset(
      createRequest("GET", "/index.html?x=1"),
      createResponse(),
      CLIENT_DIRECTORY,
    );

    expect(served).toBe(false);
    expect(mocks.stat).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "/", "//"])(
    "does not answer the root request %j",
    async (url) => {
      const served = await serveStaticAsset(
        createRequest("GET", url),
        createResponse(),
        CLIENT_DIRECTORY,
      );

      expect(served).toBe(false);
      expect(mocks.stat).not.toHaveBeenCalled();
    },
  );

  it.each(["/.env", "/assets/.hidden/app.js", "/..%2fsecret"])(
    "refuses the hidden or traversing path %s",
    async (url) => {
      const served = await serveStaticAsset(
        createRequest("GET", url),
        createResponse(),
        CLIENT_DIRECTORY,
      );

      expect(served).toBe(false);
      expect(mocks.stat).not.toHaveBeenCalled();
    },
  );

  it("keeps an encoded dot segment inside the client directory", async () => {
    // The URL parser collapses %2e%2e before the path is decoded.
    await serveStaticAsset(
      createRequest("HEAD", "/assets/%2E%2E/%2e%2e/etc/passwd"),
      createResponse(),
      CLIENT_DIRECTORY,
    );

    expect(mocks.stat).toHaveBeenCalledWith(
      path.resolve(CLIENT_DIRECTORY, "etc", "passwd"),
    );
  });
});

describe("serveStaticAsset malformed requests", () => {
  it("refuses a path with an encoded null byte without logging an error", async () => {
    const served = await serveStaticAsset(
      createRequest("GET", "/assets/app.js%00.png"),
      createResponse(),
      CLIENT_DIRECTORY,
    );

    expect(served).toBe(false);
    expect(mocks.stat).not.toHaveBeenCalled();
    expect(mocks.logCaughtError).not.toHaveBeenCalled();
  });

  it("logs and refuses a malformed percent encoding", async () => {
    const served = await serveStaticAsset(
      createRequest("GET", "/assets/%E0%A4%A"),
      createResponse(),
      CLIENT_DIRECTORY,
    );

    expect(served).toBe(false);
    expect(mocks.logCaughtError).toHaveBeenCalledWith(
      "StaticAssets",
      expect.any(URIError),
    );
    expect(mocks.stat).not.toHaveBeenCalled();
  });

  it("leaves a directory or a missing file to the application", async () => {
    mocks.stat.mockResolvedValueOnce({ isFile: () => false, size: 0 });
    const missing = new Error("missing");
    const directoryServed = await serveStaticAsset(
      createRequest("GET", "/assets"),
      createResponse(),
      CLIENT_DIRECTORY,
    );
    mocks.stat.mockRejectedValueOnce(missing);
    const missingServed = await serveStaticAsset(
      createRequest("GET", "/gone.js"),
      createResponse(),
      CLIENT_DIRECTORY,
    );

    expect(directoryServed).toBe(false);
    expect(missingServed).toBe(false);
    expect(mocks.logFileProbeError).toHaveBeenCalledExactlyOnceWith(
      "StaticAssets",
      missing,
    );
  });
});

describe("serveStaticAsset answers", () => {
  it("resolves the file below the client directory and sends the headers of a hashed asset", async () => {
    const response = createResponse();
    const stream = new PassThrough();
    const pipe = vi.spyOn(stream, "pipe").mockReturnValue(response);
    mocks.createReadStream.mockReturnValue(stream);
    mocks.stat.mockResolvedValue(regularFile(2048));

    const served = await serveStaticAsset(
      createRequest("GET", "/assets/app-3f2a.JS?v=1"),
      response,
      CLIENT_DIRECTORY,
    );

    const expectedPath = path.resolve(
      CLIENT_DIRECTORY,
      "assets",
      "app-3f2a.JS",
    );
    expect(served).toBe(true);
    expect(mocks.stat).toHaveBeenCalledWith(expectedPath);
    expect(mocks.createReadStream).toHaveBeenCalledWith(expectedPath);
    expect(response.writeHead).toHaveBeenCalledWith(200, {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": 2048,
      "Content-Type": "text/javascript; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    expect(pipe).toHaveBeenCalledWith(response);
    expect(response.end).not.toHaveBeenCalled();
  });
});

describe("serveStaticAsset file responses", () => {
  it("sends only the headers for a HEAD request", async () => {
    const response = createResponse();

    const served = await serveStaticAsset(
      createRequest("HEAD", "/assets/style.css"),
      response,
      CLIENT_DIRECTORY,
    );

    expect(served).toBe(true);
    expect(response.writeHead).toHaveBeenCalledTimes(1);
    expect(response.end).toHaveBeenCalledWith();
    expect(mocks.createReadStream).not.toHaveBeenCalled();
  });

  it("decodes encoded characters of a legitimate file name", async () => {
    const response = createResponse();

    await serveStaticAsset(
      createRequest("HEAD", "/img/my%20logo.png"),
      response,
      CLIENT_DIRECTORY,
    );

    expect(mocks.stat).toHaveBeenCalledWith(
      path.resolve(CLIENT_DIRECTORY, "img", "my logo.png"),
    );
  });

  it.each([
    ["/favicon.ico", "image/x-icon"],
    ["/a.jpeg", "image/jpeg"],
    ["/a.jpg", "image/jpeg"],
    ["/a.json", "application/json; charset=utf-8"],
    ["/a.js.map", "application/json; charset=utf-8"],
    ["/a.png", "image/png"],
    ["/a.svg", "image/svg+xml"],
    ["/robots.txt", "text/plain; charset=utf-8"],
    ["/a.webp", "image/webp"],
    ["/a.woff", "font/woff"],
    ["/a.woff2", "font/woff2"],
    ["/a.PNG", "image/png"],
    ["/a.unknown", "application/octet-stream"],
    ["/LICENSE", "application/octet-stream"],
  ])("serves %s as %s", async (url, contentType) => {
    const response = createResponse();

    await serveStaticAsset(
      createRequest("HEAD", url),
      response,
      CLIENT_DIRECTORY,
    );

    expect(sentHeaders(response)["Content-Type"]).toBe(contentType);
  });

  it.each([
    ["/sw.js", "no-cache"],
    ["/assets/app.js", "public, max-age=31536000, immutable"],
    ["/locales/en.json", "public, max-age=3600"],
  ])("caches %s with %s", async (url, cacheControl) => {
    const response = createResponse();

    await serveStaticAsset(
      createRequest("HEAD", url),
      response,
      CLIENT_DIRECTORY,
    );

    expect(sentHeaders(response)["Cache-Control"]).toBe(cacheControl);
  });

  it("logs a stream failure and destroys the response instead of crashing", async () => {
    const response = createResponse();
    const stream = new PassThrough();
    vi.spyOn(stream, "pipe").mockReturnValue(response);
    mocks.createReadStream.mockReturnValue(stream);
    await serveStaticAsset(
      createRequest("GET", "/assets/app.js"),
      response,
      CLIENT_DIRECTORY,
    );
    const error = new Error("file vanished");

    stream.emit("error", error);

    expect(mocks.logEvent).toHaveBeenCalledWith({
      level: "error",
      event: "http.asset.failed",
      component: "StaticAssets",
      message: "Static asset stream failed",
      error,
    });
    expect(response.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("refuseMissingAsset", () => {
  it("answers a missing hashed file with an uncached 404", () => {
    const response = createResponse();

    const refused = refuseMissingAsset(
      createRequest("GET", "/assets/old-1a2b.js"),
      response,
    );

    expect(refused).toBe(true);
    expect(response.writeHead).toHaveBeenCalledWith(404, {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    expect(response.end).toHaveBeenCalledWith("Not Found");
  });

  it("sends no body for a HEAD request", () => {
    const response = createResponse();

    const refused = refuseMissingAsset(
      createRequest("HEAD", "/assets/old-1a2b.js"),
      response,
    );

    expect(refused).toBe(true);
    expect(response.end).toHaveBeenCalledWith(undefined);
  });

  it.each(["/", "/projects/1", "/assetsx/app.js", "/assets"])(
    "leaves %s to the application",
    (url) => {
      const response = createResponse();

      expect(refuseMissingAsset(createRequest("GET", url), response)).toBe(
        false,
      );
      expect(response.writeHead).not.toHaveBeenCalled();
    },
  );

  it("leaves a request without a URL to the application", () => {
    expect(
      refuseMissingAsset(createRequest("GET", undefined), createResponse()),
    ).toBe(false);
  });

  it("leaves a malformed path to the application", () => {
    expect(
      refuseMissingAsset(
        createRequest("GET", "/assets/%E0%A4%A"),
        createResponse(),
      ),
    ).toBe(false);
  });

  it("leaves other methods to the application", () => {
    const response = createResponse();

    expect(
      refuseMissingAsset(createRequest("POST", "/assets/app.js"), response),
    ).toBe(false);
    expect(response.writeHead).not.toHaveBeenCalled();
  });
});
