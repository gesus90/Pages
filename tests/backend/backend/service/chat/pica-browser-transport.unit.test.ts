import { EventEmitter } from "node:events";
import { gzipSync } from "node:zlib";

import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { PicaBrowserUpstreamRequest } from "@/backend/service/chat/browser/PicaBrowserTransport";

const boundary = vi.hoisted(() => ({ request: vi.fn(), destroy: vi.fn() }));
vi.mock("node:http", () => ({
  Agent: class {
    public destroy = boundary.destroy;
  },
  request: boundary.request,
}));
vi.mock("node:https", () => ({
  Agent: class {
    public destroy = boundary.destroy;
  },
  request: boundary.request,
}));

import { PicaBrowserTransport } from "@/backend/service/chat/browser/PicaBrowserTransport";

const request = partial<PicaBrowserUpstreamRequest>({
  target: {
    url: new URL("https://example.com/path?q=1"),
    address: "203.0.113.1",
  },
  method: "POST",
  headers: { host: "attacker", cookie: "forged", "x-custom": "value" },
  cookie: "safe=1",
  body: Buffer.from("hi"),
  signal: new AbortController().signal,
});

function reply(body: Buffer, headers: Record<string, string>): void {
  boundary.request.mockImplementation((options, callback) => {
    const call = new EventEmitter();
    Object.assign(call, {
      end: () => {
        const response = new EventEmitter();
        Object.assign(response, {
          statusCode: 200,
          headers,
          destroy: (error: Error) => response.emit("error", error),
        });
        callback(response);
        setImmediate(() => {
          response.emit("data", body);
          response.emit("end");
        });
      },
    });
    expect(options.hostname).toBe("203.0.113.1");
    return call;
  });
}

beforeEach(() => vi.resetAllMocks());

it("pins the address, controls sensitive headers and decompresses the response", async () => {
  reply(gzipSync(Buffer.from("hello")), {
    "content-encoding": "gzip",
    connection: "close",
    "content-type": "text/plain",
  });
  const transport = new PicaBrowserTransport({
    responseBytes: 100,
    requestMilliseconds: 1000,
  });
  const result = await transport.send(request);
  expect(result).toEqual({
    status: 200,
    headers: { "content-type": "text/plain" },
    body: Buffer.from("hello"),
  });
  const options: unknown = boundary.request.mock.calls[0][0];
  if (
    typeof options !== "object" ||
    options === null ||
    !("headers" in options) ||
    !("servername" in options)
  )
    throw new Error("Expected request options");
  expect(options.headers).toMatchObject({
    Host: "example.com",
    Cookie: "safe=1",
    "x-custom": "value",
    "Content-Length": "2",
  });
  expect(options.headers).not.toHaveProperty("cookie");
  expect(options.servername).toBe("example.com");
  transport.close();
  expect(boundary.destroy).toHaveBeenCalledTimes(2);
});

it("rejects an oversized response before returning it", async () => {
  reply(Buffer.from("too long"), {});
  const transport = new PicaBrowserTransport({
    responseBytes: 2,
    requestMilliseconds: 1000,
  });
  await expect(transport.send(request)).rejects.toThrow();
});
