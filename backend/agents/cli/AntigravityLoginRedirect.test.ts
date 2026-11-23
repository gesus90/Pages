import { EventEmitter } from "node:events";

import { afterEach, expect, it, vi } from "vitest";

import {
  deliverAntigravityRedirect,
  readAntigravityRedirect,
} from "@/backend/agents/cli/AntigravityLoginRedirect";

import type { RequestOptions } from "node:http";

const network = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("node:http", () => network);

const EXPECTED = { port: 41234, state: "state-value" };

it("returns the query of an address with a code", () => {
  expect(
    readAntigravityRedirect(
      "http://127.0.0.1:41234/?state=state-value&code=abc",
      EXPECTED,
    ),
  ).toBe("state=state-value&code=abc");
});

it("accepts an address without a scheme and a provider error", () => {
  expect(
    readAntigravityRedirect(
      "  127.0.0.1:41234/?state=state-value&error=access_denied ",
      EXPECTED,
    ),
  ).toBe("state=state-value&error=access_denied");
});

it("accepts an upper-case scheme", () => {
  expect(
    readAntigravityRedirect(
      "HTTPS://127.0.0.1:41234/?state=state-value&code=abc",
      EXPECTED,
    ),
  ).toBe("state=state-value&code=abc");
});

const base = "http://127.0.0.1:41234/?state=state-value";

it.each([
  ["an empty address", ""],
  ["a blank address", "   "],
  ["an oversized address", `${base}&code=${"a".repeat(5000)}`],
  ["an address with whitespace", `${base}&code=a b`],
  ["an address with a control character", `${base}&code=a\u0001b`],
  ["an unparsable address", "http://[broken"],
  ["another host", "http://localhost:41234/?state=state-value&code=a"],
  ["another port", "http://127.0.0.1:41235/?state=state-value&code=a"],
  ["another path", "http://127.0.0.1:41234/x?state=state-value&code=a"],
  ["a user name", "http://user@127.0.0.1:41234/?state=state-value&code=a"],
  [
    "a password",
    "http://user:secret@127.0.0.1:41234/?state=state-value&code=a",
  ],
  ["a fragment", `${base}&code=a#fragment`],
  ["a missing state", "http://127.0.0.1:41234/?code=a"],
  ["an empty state", "http://127.0.0.1:41234/?state=&code=a"],
  ["a repeated state", `${base}&state=state-value&code=a`],
  [
    "another state of equal length",
    "http://127.0.0.1:41234/?state=state-valuX&code=a",
  ],
  [
    "another state of other length",
    "http://127.0.0.1:41234/?state=other&code=a",
  ],
  ["a repeated code", `${base}&code=a&code=b`],
  ["a repeated error", `${base}&error=a&error=b`],
  ["neither code nor error", base],
  ["an empty code", `${base}&code=`],
])("refuses %s", (label, address) => {
  expect(() => readAntigravityRedirect(address, EXPECTED)).toThrow(
    expect.objectContaining({ code: "login_callback_invalid" }),
  );
});

type Handler = (response: { resume: () => void; statusCode?: number }) => void;

class FakeRequest extends EventEmitter {
  public readonly end = vi.fn();
  public readonly destroy = vi.fn();
}

function fakeRequest(): {
  outgoing: FakeRequest;
  options: () => RequestOptions;
  respond: Handler;
} {
  const outgoing = new FakeRequest();
  let captured: RequestOptions | null = null;
  let handler: Handler | null = null;
  network.request.mockImplementation(
    (options: RequestOptions, callback: Handler) => {
      captured = options;
      handler = callback;
      return outgoing;
    },
  );
  return {
    outgoing,
    options: () => captured as RequestOptions,
    respond: (response) => handler?.(response),
  };
}

afterEach(() => {
  network.request.mockReset();
});

it("sends one loopback request and resolves for a success status", async () => {
  const fake = fakeRequest();
  const signal = new AbortController().signal;
  const resume = vi.fn();

  const delivery = deliverAntigravityRedirect(EXPECTED, "code=a", signal);
  fake.respond({ resume, statusCode: 302 });

  await expect(delivery).resolves.toBeUndefined();
  expect(fake.options()).toMatchObject({
    host: "127.0.0.1",
    port: EXPECTED.port,
    path: "/?code=a",
    method: "GET",
    signal,
  });
  expect(fake.outgoing.end).toHaveBeenCalledOnce();
  expect(resume).toHaveBeenCalledOnce();
});

it.each([[500], [199], [undefined]])(
  "rejects the status %s as unreachable",
  async (statusCode) => {
    const fake = fakeRequest();

    const delivery = deliverAntigravityRedirect(
      EXPECTED,
      "code=a",
      new AbortController().signal,
    );
    fake.respond({ resume: vi.fn(), statusCode });

    await expect(delivery).rejects.toMatchObject({
      code: "login_callback_unreachable",
    });
  },
);

it("rejects a transport error with the stable code only", async () => {
  const fake = fakeRequest();

  const delivery = deliverAntigravityRedirect(
    EXPECTED,
    "code=a",
    new AbortController().signal,
  );
  fake.outgoing.emit("error", new Error("connect ECONNREFUSED 127.0.0.1"));

  await expect(delivery).rejects.toMatchObject({
    code: "login_callback_unreachable",
  });
});

it("destroys the request when it times out", async () => {
  const fake = fakeRequest();

  const delivery = deliverAntigravityRedirect(
    EXPECTED,
    "code=a",
    new AbortController().signal,
  );
  fake.outgoing.emit("timeout");
  fake.respond({ resume: vi.fn(), statusCode: 200 });

  await delivery;
  expect(fake.outgoing.destroy).toHaveBeenCalledOnce();
});
