import { IncomingMessage } from "node:http";
import { Socket } from "node:net";

import { expect, it } from "vitest";

import {
  admitForwardedHeaders,
  createForwardedHttpsCheck,
  createTrustedPeerCheck,
  forwardedClientAddress,
  readForwardedProtocol,
  UNSUPPORTED_FORWARDING_HEADERS,
} from "./ForwardedProtocol";

function fakeRequest(
  remoteAddress: string | undefined,
  protocol: string | string[] | undefined,
): IncomingMessage {
  const socket = new Socket();
  Object.defineProperty(socket, "remoteAddress", { value: remoteAddress });
  const request = new IncomingMessage(socket);
  request.headers["x-forwarded-proto"] = protocol;
  return request;
}

it("trusts listed addresses and ranges and ignores invalid entries", () => {
  const check = createTrustedPeerCheck([
    "10.0.0.1",
    "192.168.0.0/16",
    "2001:db8::/32",
    "not-an-address",
    "10.1.1.1/0",
  ]);

  expect(check("10.0.0.1")).toBe(true);
  expect(check("192.168.4.5")).toBe(true);
  expect(check("2001:db8::7")).toBe(true);
  expect(check("10.1.1.1")).toBe(false);
  expect(check("8.8.8.8")).toBe(false);
});

it("matches an IPv4 client of a dual-stack socket against IPv4 entries", () => {
  const check = createTrustedPeerCheck(["10.0.0.1"]);

  expect(check("::ffff:10.0.0.1")).toBe(true);
});

it("rejects a missing or malformed peer address", () => {
  const check = createTrustedPeerCheck(["10.0.0.1"], {
    isLoopbackTrusted: true,
  });

  expect(check(undefined)).toBe(false);
  expect(check("")).toBe(false);
  expect(check("localhost")).toBe(false);
});

it("trusts loopback peers only when asked to", () => {
  const withLoopback = createTrustedPeerCheck([], { isLoopbackTrusted: true });
  const without = createTrustedPeerCheck([]);

  expect(withLoopback("127.0.0.1")).toBe(true);
  expect(withLoopback("127.9.9.9")).toBe(true);
  expect(withLoopback("::1")).toBe(true);
  expect(withLoopback("8.8.8.8")).toBe(false);
  expect(without("127.0.0.1")).toBe(false);
  expect(createTrustedPeerCheck([], { isLoopbackTrusted: false })("::1")).toBe(
    false,
  );
});

it("reads the first protocol of a header or a list of headers", () => {
  expect(readForwardedProtocol("https")).toBe("https");
  expect(readForwardedProtocol(" HTTP , https")).toBe("http");
  expect(readForwardedProtocol(["https", "http"])).toBe("https");
});

it("reads nothing from an absent, empty or unknown protocol", () => {
  expect(readForwardedProtocol(undefined)).toBeNull();
  expect(readForwardedProtocol([])).toBeNull();
  expect(readForwardedProtocol("")).toBeNull();
  expect(readForwardedProtocol("ftp")).toBeNull();
});

it("accepts https only from a trusted peer that reports https", () => {
  const check = createForwardedHttpsCheck(["10.0.0.1"]);

  expect(check(fakeRequest("10.0.0.1", "https"))).toBe(true);
  expect(check(fakeRequest("10.0.0.1", "http"))).toBe(false);
  expect(check(fakeRequest("10.0.0.1", undefined))).toBe(false);
  expect(check(fakeRequest("6.6.6.6", "https"))).toBe(false);
  expect(check(fakeRequest(undefined, "https"))).toBe(false);
});

it("takes the nearest forwarded client only from a trusted peer", () => {
  const trusted = (address: string | undefined): boolean =>
    address === "10.0.0.1";

  expect(forwardedClientAddress("10.0.0.1", "1.1.1.1, 2.2.2.2", trusted)).toBe(
    "2.2.2.2",
  );
  expect(forwardedClientAddress("6.6.6.6", "1.1.1.1", trusted)).toBe("6.6.6.6");
});

it("keeps the peer without a header or with an invalid nearest address", () => {
  const trusted = (): boolean => true;

  expect(forwardedClientAddress("10.0.0.1", null, trusted)).toBe("10.0.0.1");
  expect(forwardedClientAddress("10.0.0.1", "1.1.1.1, bogus", trusted)).toBe(
    "10.0.0.1",
  );
  expect(forwardedClientAddress("10.0.0.1", "", trusted)).toBe("10.0.0.1");
  expect(forwardedClientAddress("10.0.0.1", "   ", trusted)).toBe("10.0.0.1");
  expect(forwardedClientAddress("10.0.0.1", "1.1.1.1,", trusted)).toBe(
    "10.0.0.1",
  );
});

it("uses a single forwarded entry and trims the last entry", () => {
  const trusted = (): boolean => true;

  expect(forwardedClientAddress("10.0.0.1", " 2.2.2.2 ", trusted)).toBe(
    "2.2.2.2",
  );
  expect(forwardedClientAddress("10.0.0.1", "1.1.1.1,2.2.2.2  ", trusted)).toBe(
    "2.2.2.2",
  );
});

function trustOf(
  trustedProxy: boolean,
  trustedClient: boolean,
): {
  isTrustedProxy: () => boolean;
  isTrustedClientPeer: () => boolean;
} {
  return {
    isTrustedProxy: () => trustedProxy,
    isTrustedClientPeer: () => trustedClient,
  };
}

it("admits a trusted proxy's headers and strips other conventions", () => {
  const headers = new Headers({
    "x-forwarded-proto": "HTTPS",
    "x-forwarded-for": "1.1.1.1",
  });
  for (const name of UNSUPPORTED_FORWARDING_HEADERS) headers.set(name, "x");

  const entry = admitForwardedHeaders(
    headers,
    { peer: "10.0.0.1", protocol: "https" },
    trustOf(true, true),
  );

  expect(entry).toEqual({
    reportedProtocol: "https",
    isTrustedProxy: true,
    isForwarded: true,
  });
  expect(headers.get("x-forwarded-for")).toBe("1.1.1.1");
  expect(headers.get("x-forwarded-proto")).toBe("https");
  for (const name of UNSUPPORTED_FORWARDING_HEADERS)
    expect(headers.has(name)).toBe(false);
});

it("replaces the client address of an untrusted peer and marks a bare request as not forwarded", () => {
  const headers = new Headers();

  const entry = admitForwardedHeaders(
    headers,
    { peer: "6.6.6.6", protocol: "http" },
    trustOf(false, false),
  );

  expect(entry).toEqual({
    reportedProtocol: "absent",
    isTrustedProxy: false,
    isForwarded: false,
  });
  expect(headers.get("x-forwarded-for")).toBe("6.6.6.6");
  expect(headers.get("x-forwarded-proto")).toBe("http");
});

it("flags forwarding from the protocol header, a blank value or the for header", () => {
  const untrusted = trustOf(false, false);
  const request = { peer: "6.6.6.6", protocol: "http" } as const;

  expect(
    admitForwardedHeaders(
      new Headers({ "x-forwarded-proto": "gopher" }),
      request,
      untrusted,
    ),
  ).toMatchObject({ reportedProtocol: "invalid", isForwarded: true });
  expect(
    admitForwardedHeaders(
      new Headers({ "x-forwarded-proto": "   " }),
      request,
      untrusted,
    ),
  ).toMatchObject({ reportedProtocol: "absent", isForwarded: false });
  expect(
    admitForwardedHeaders(
      new Headers({ "x-forwarded-for": "1.1.1.1" }),
      request,
      untrusted,
    ),
  ).toMatchObject({ reportedProtocol: "absent", isForwarded: true });
});
