import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { PassThrough } from "node:stream";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();

  return { ...actual, createReadStream: vi.fn(actual.createReadStream) };
});

import { serveStaticAsset } from "@/backend/runtime/StaticAssets";

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

describe("serveStaticAsset", () => {
  let root: string;
  let clientDirectory: string;
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "pages-static-"));
    clientDirectory = path.join(root, "client");
    await mkdir(path.join(clientDirectory, "assets"), { recursive: true });
    await writeFile(path.join(clientDirectory, "assets", "app-1a2b.js"), "js");
    await writeFile(path.join(clientDirectory, "assets", "font.WOFF2"), "f");
    await writeFile(path.join(clientDirectory, "favicon.ico"), "ico");
    await writeFile(path.join(clientDirectory, "data.bin"), "bin");
    await writeFile(path.join(clientDirectory, ".secret"), "hidden");
    await writeFile(path.join(root, "server.js"), "server code");
    await mkdir(path.join(clientDirectory, "folder"));

    server = createServer((request, response) => {
      void serveStaticAsset(request, response, clientDirectory).then(
        (isServed) => {
          if (!isServed) {
            response.writeHead(404).end("application");
          }
        },
      );
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { force: true, recursive: true });
  });

  it("serves hashed build files with long caching", async () => {
    const response = await fetch(`${origin}/assets/app-1a2b.js`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("js");
    expect(response.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("serves other files with short caching and known or generic types", async () => {
    const icon = await fetch(`${origin}/favicon.ico`);
    const font = await fetch(`${origin}/assets/font.WOFF2`);
    const binary = await fetch(`${origin}/data.bin`);

    expect(icon.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(icon.headers.get("content-type")).toBe("image/x-icon");
    expect(font.headers.get("content-type")).toBe("font/woff2");
    expect(binary.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("answers HEAD requests without a body", async () => {
    const response = await fetch(`${origin}/favicon.ico`, { method: "HEAD" });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("3");
    expect(await response.text()).toBe("");
  });

  it.each([
    "/",
    "/dashboard",
    "/folder",
    "/.secret",
    "/assets/..%2f..%2fserver.js",
    "/%2e%2e/server.js",
    "/assets/%E0%A4%A",
    "/assets/app-1a2b.js%00.png",
  ])("leaves %s to the application", async (requestPath) => {
    const response = await fetch(`${origin}${requestPath}`);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("application");
  });

  it("leaves other methods to the application", async () => {
    const response = await fetch(`${origin}/favicon.ico`, { method: "POST" });

    expect(await response.text()).toBe("application");
  });

  it("ends the response when the file disappears while it is sent", async () => {
    const destroy = vi.fn();
    const response = {
      destroy,
      end: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      emit: vi.fn(),
      write: vi.fn(),
      writeHead: vi.fn(),
    };
    const stream = new PassThrough();

    vi.mocked(createReadStream).mockReturnValueOnce(
      stream as unknown as ReturnType<typeof createReadStream>,
    );

    await serveStaticAsset(
      { method: "GET", url: "/favicon.ico" } as never,
      response as never,
      clientDirectory,
    );
    stream.emit("error", new Error("gone"));

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("treats a request without a URL as the root path", async () => {
    await expect(
      serveStaticAsset(
        { method: "GET" } as never,
        {} as never,
        clientDirectory,
      ),
    ).resolves.toBe(false);
  });
});
