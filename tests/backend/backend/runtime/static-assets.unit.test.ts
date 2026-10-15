import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { serveStaticAsset } from "@/backend/runtime/StaticAssets";

import { createStaticExchange } from "./static-asset-exchange";

const CLIENT = "/srv/pages/build/client";

const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  directories: new Set<string>(),
  statCalls: [] as string[],
  opened: [] as string[],
  breakStream: false,
}));

vi.mock("node:fs/promises", () => ({
  stat: async (location: string) => {
    disk.statCalls.push(location);
    const content = disk.files.get(location);
    if (content !== undefined) {
      return { isFile: () => true, size: Buffer.byteLength(content) };
    }
    if (disk.directories.has(location)) {
      return { isFile: () => false, size: 4096 };
    }
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  },
}));

vi.mock("node:fs", async () => {
  const { Readable } = await import("node:stream");

  return {
    createReadStream: (location: string) => {
      disk.opened.push(location);
      if (disk.breakStream) {
        return new Readable({
          read(): void {
            this.destroy(new Error("The file vanished."));
          },
        });
      }

      return Readable.from([Buffer.from(disk.files.get(location) ?? "")]);
    },
  };
});

beforeEach(() => {
  disk.files.clear();
  disk.directories.clear();
  disk.statCalls.length = 0;
  disk.opened.length = 0;
  disk.breakStream = false;
  disk.files.set(`${CLIENT}/assets/app-1a2b3c.js`, "console.info(1);");
  disk.files.set(`${CLIENT}/assets/style-9f.css`, "body{}");
  disk.files.set(`${CLIENT}/favicon.ico`, "ICO");
  disk.files.set(`${CLIENT}/robots.txt`, "User-agent: *");
  disk.files.set(`${CLIENT}/logo.PNG`, "PNG");
  disk.files.set(`${CLIENT}/archive.tar`, "TAR");
  disk.files.set(`${CLIENT}/LICENSE`, "MIT");
  disk.files.set("/srv/pages/build/server.mjs", "secret server code");
  disk.files.set("/etc/passwd", "root:x:0:0");
  disk.directories.add(`${CLIENT}/assets`);
});

describe("served files", () => {
  it("sends a hashed build file with the immutable cache header", async () => {
    const exchange = createStaticExchange("GET", "/assets/app-1a2b3c.js");

    const isServed = await serveStaticAsset(
      exchange.request,
      exchange.response,
      CLIENT,
    );
    await exchange.finished;

    expect(isServed).toBe(true);
    expect(exchange.status()).toBe(200);
    expect(exchange.headers()).toEqual({
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": 16,
      "Content-Type": "text/javascript; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    expect(exchange.body()).toBe("console.info(1);");
  });

  it("gives other files a one hour cache", async () => {
    const exchange = createStaticExchange("GET", "/favicon.ico");

    await serveStaticAsset(exchange.request, exchange.response, CLIENT);
    await exchange.finished;

    expect(exchange.headers()).toMatchObject({
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "image/x-icon",
    });
  });

  it.each([
    ["/assets/style-9f.css", "text/css; charset=utf-8"],
    ["/robots.txt", "text/plain; charset=utf-8"],
    ["/logo.PNG", "image/png"],
    ["/archive.tar", "application/octet-stream"],
    ["/LICENSE", "application/octet-stream"],
  ])("labels %s as %s", async (url, contentType) => {
    const exchange = createStaticExchange("GET", url);

    await serveStaticAsset(exchange.request, exchange.response, CLIENT);

    expect(exchange.headers()?.["Content-Type"]).toBe(contentType);
  });

  it("always forbids content type sniffing", async () => {
    const exchange = createStaticExchange("GET", "/archive.tar");

    await serveStaticAsset(exchange.request, exchange.response, CLIENT);

    expect(exchange.headers()?.["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("answers a HEAD request with the headers and no body", async () => {
    const exchange = createStaticExchange("HEAD", "/assets/app-1a2b3c.js");

    const isServed = await serveStaticAsset(
      exchange.request,
      exchange.response,
      CLIENT,
    );
    await exchange.finished;

    expect(isServed).toBe(true);
    expect(exchange.headers()).toMatchObject({ "Content-Length": 16 });
    expect(exchange.endedWithoutBody()).toBe(true);
    expect(disk.opened).toEqual([]);
  });

  it("ignores the query string", async () => {
    const exchange = createStaticExchange("GET", "/assets/style-9f.css?v=3");

    const isServed = await serveStaticAsset(
      exchange.request,
      exchange.response,
      CLIENT,
    );

    expect(isServed).toBe(true);
    expect(disk.statCalls).toEqual([`${CLIENT}/assets/style-9f.css`]);
  });

  it("decodes an encoded file name", async () => {
    disk.files.set(`${CLIENT}/my logo.png`, "PNG");
    const exchange = createStaticExchange("GET", "/my%20logo.png");

    await expect(
      serveStaticAsset(exchange.request, exchange.response, CLIENT),
    ).resolves.toBe(true);
  });

  it("resolves a relative client directory below the working directory", async () => {
    const relative = "build/client";
    const absolute = path.resolve(relative);
    disk.files.set(`${absolute}/favicon.ico`, "ICO");
    const exchange = createStaticExchange("GET", "/favicon.ico");

    await expect(
      serveStaticAsset(exchange.request, exchange.response, relative),
    ).resolves.toBe(true);
  });
});

describe("requests left to the application", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "does not answer a %s request and does not look at the disk",
    async (method) => {
      const exchange = createStaticExchange(method, "/favicon.ico");

      const isServed = await serveStaticAsset(
        exchange.request,
        exchange.response,
        CLIENT,
      );

      expect(isServed).toBe(false);
      expect(disk.statCalls).toEqual([]);
      expect(exchange.status()).toBeNull();
    },
  );

  it.each([
    ["the root", "/"],
    ["a missing request target", undefined],
    ["a file that does not exist", "/assets/missing.js"],
    ["a directory", "/assets"],
    ["a directory with a trailing slash", "/assets/"],
  ])("does not answer %s", async (_, url) => {
    const exchange = createStaticExchange("GET", url);

    const isServed = await serveStaticAsset(
      exchange.request,
      exchange.response,
      CLIENT,
    );

    expect(isServed).toBe(false);
    expect(exchange.status()).toBeNull();
  });
});

describe("path traversal", () => {
  it.each([
    ["a parent segment", "/../server.mjs"],
    ["an encoded parent segment", "/%2e%2e/server.mjs"],
    ["an upper case encoded parent", "/assets/%2E%2E/%2E%2E/server.mjs"],
    ["an encoded slash between parents", "/..%2f..%2fetc/passwd"],
    ["a backslash parent", "/..%5cserver.mjs"],
    ["a hidden file", "/.env"],
    ["a hidden directory", "/.git/config"],
    ["a hidden segment inside a path", "/assets/.hidden/app.js"],
    ["a null byte", "/favicon.ico%00.png"],
    ["a broken escape sequence", "/%E0%A4%A"],
    ["an encoded absolute path", "/%2Fetc%2Fpasswd"],
  ])("does not read the disk for %s", async (_, url) => {
    const exchange = createStaticExchange("GET", url);

    const isServed = await serveStaticAsset(
      exchange.request,
      exchange.response,
      CLIENT,
    );

    expect(isServed).toBe(false);
    expect(exchange.status()).toBeNull();
    expect(disk.opened).toEqual([]);
    for (const location of disk.statCalls) {
      expect(location.startsWith(`${CLIENT}${path.sep}`)).toBe(true);
    }
  });

  it("keeps a protocol-relative target inside the client directory", async () => {
    const exchange = createStaticExchange("GET", "//etc/passwd");

    const isServed = await serveStaticAsset(
      exchange.request,
      exchange.response,
      CLIENT,
    );

    expect(isServed).toBe(false);
    expect(disk.statCalls).toEqual([`${CLIENT}/passwd`]);
  });

  it("never serves the server bundle next to the client directory", async () => {
    const exchange = createStaticExchange("GET", "/../server.mjs");

    await serveStaticAsset(exchange.request, exchange.response, CLIENT);

    expect(exchange.body()).toBe("");
    expect(disk.statCalls).toEqual([`${CLIENT}/server.mjs`]);
  });
});

describe("file removed while sending", () => {
  it("destroys the response instead of throwing", async () => {
    disk.breakStream = true;
    const exchange = createStaticExchange("GET", "/favicon.ico");

    const isServed = await serveStaticAsset(
      exchange.request,
      exchange.response,
      CLIENT,
    );
    await vi.waitFor(() => {
      expect(exchange.destroyed()).toBe(true);
    });

    expect(isServed).toBe(true);
  });
});
