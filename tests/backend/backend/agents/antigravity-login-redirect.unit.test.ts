import { EventEmitter } from "node:events";

import { expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("node:http", () => ({ request }));

import {
  deliverAntigravityRedirect,
  readAntigravityRedirect,
} from "@/backend/agents/cli/AntigravityLoginRedirect";

const callback = { port: 1234, state: "expected" };

it("accepts only the expected loopback callback and returns its query", () => {
  expect(
    readAntigravityRedirect(
      "127.0.0.1:1234/?state=expected&code=code",
      callback,
    ),
  ).toBe("state=expected&code=code");
  expect(
    readAntigravityRedirect(
      "http://127.0.0.1:1234/?state=expected&error=denied",
      callback,
    ),
  ).toBe("state=expected&error=denied");
});

it.each([
  "",
  "http://localhost:1234/?state=expected&code=code",
  "http://127.0.0.1:4321/?state=expected&code=code",
  "http://127.0.0.1:1234/path?state=expected&code=code",
  "http://127.0.0.1:1234/?state=wrong&code=code",
  "http://127.0.0.1:1234/?state=expected&state=expected&code=code",
  "http://127.0.0.1:1234/?state=expected&code=one&code=two",
  "http://127.0.0.1:1234/?state=expected",
  "http://127.0.0.1:1234/?state=expected&code=code#fragment",
])("rejects an invalid callback address", (address) => {
  expect(() => readAntigravityRedirect(address, callback)).toThrow();
});

it("delivers the accepted query to a simulated fixed loopback listener", async () => {
  request.mockImplementation((options, callbackReply) => {
    expect(options).toMatchObject({
      host: "127.0.0.1",
      port: 1234,
      path: "/?state=expected&code=code",
    });
    const outgoing = new EventEmitter();
    Object.assign(outgoing, {
      end: () => callbackReply({ statusCode: 204, resume: vi.fn() }),
    });
    return outgoing;
  });
  await expect(
    deliverAntigravityRedirect(
      callback,
      "state=expected&code=code",
      new AbortController().signal,
    ),
  ).resolves.toBeUndefined();
});
