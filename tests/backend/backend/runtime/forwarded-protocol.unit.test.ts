import { describe, expect, it } from "vitest";

import { createForwardedHttpsCheck } from "@/backend/runtime/ForwardedProtocol";

import { createStaticExchange } from "./static-asset-exchange";

import type { IncomingHttpHeaders } from "node:http";

function requestFrom(
  peer: string | undefined,
  headers: IncomingHttpHeaders,
): ReturnType<typeof createStaticExchange>["request"] {
  const { request } = createStaticExchange("POST", "/login");
  Object.defineProperty(request.socket, "remoteAddress", { value: peer });
  request.headers = headers;

  return request;
}

const HTTPS = { "x-forwarded-proto": "https" };

describe("createForwardedHttpsCheck", () => {
  it("trusts a listed address and nothing else", () => {
    const check = createForwardedHttpsCheck(["192.0.2.10", "::1"]);

    expect(check(requestFrom("192.0.2.10", HTTPS))).toBe(true);
    expect(check(requestFrom("::1", HTTPS))).toBe(true);
    expect(check(requestFrom("192.0.2.11", HTTPS))).toBe(false);
    expect(check(requestFrom("::2", HTTPS))).toBe(false);
  });

  it("matches ranges at their edges", () => {
    const check = createForwardedHttpsCheck(["172.18.0.0/16", "fd00::/8"]);

    expect(check(requestFrom("172.18.0.1", HTTPS))).toBe(true);
    expect(check(requestFrom("172.18.255.254", HTTPS))).toBe(true);
    expect(check(requestFrom("172.17.255.255", HTTPS))).toBe(false);
    expect(check(requestFrom("172.19.0.0", HTTPS))).toBe(false);
    expect(check(requestFrom("fd12::1", HTTPS))).toBe(true);
    expect(check(requestFrom("fe00::1", HTTPS))).toBe(false);
  });

  it("matches an IPv4 peer that a dual-stack socket reports as IPv6", () => {
    const check = createForwardedHttpsCheck(["192.0.2.10", "172.18.0.0/16"]);

    expect(check(requestFrom("::ffff:192.0.2.10", HTTPS))).toBe(true);
    expect(check(requestFrom("::ffff:172.18.4.5", HTTPS))).toBe(true);
    expect(check(requestFrom("::ffff:192.0.2.11", HTTPS))).toBe(false);
  });

  it("trusts nobody without configured proxies", () => {
    const check = createForwardedHttpsCheck([]);

    expect(check(requestFrom("127.0.0.1", HTTPS))).toBe(false);
    expect(check(requestFrom("::1", HTTPS))).toBe(false);
  });

  it("ignores an entry it cannot read instead of widening the trust", () => {
    const check = createForwardedHttpsCheck(["proxy.internal", "0.0.0.0/0"]);

    expect(check(requestFrom("192.0.2.10", HTTPS))).toBe(false);
  });

  it.each([undefined, "", "not-an-address"])(
    "does not trust the peer address %j",
    (peer) => {
      const check = createForwardedHttpsCheck(["192.0.2.10", "fe80::/10"]);

      expect(check(requestFrom(peer, HTTPS))).toBe(false);
    },
  );

  it("compares a zoned link-local peer with the listed range only", () => {
    const rangeCheck = createForwardedHttpsCheck(["fe80::/10"]);
    const otherCheck = createForwardedHttpsCheck(["192.0.2.10"]);

    expect(rangeCheck(requestFrom("fe80::1%eth0", HTTPS))).toBe(true);
    expect(otherCheck(requestFrom("fe80::1%eth0", HTTPS))).toBe(false);
  });

  it.each([
    ["https", true],
    ["HTTPS", true],
    [" https ", true],
    ["https, http", true],
    ["http", false],
    ["http, https", false],
    ["https:", false],
    ["wss", false],
    ["javascript", false],
    ["", false],
  ])("reads X-Forwarded-Proto %j as forwarded HTTPS: %s", (value, expected) => {
    const check = createForwardedHttpsCheck(["192.0.2.10"]);

    expect(
      check(requestFrom("192.0.2.10", { "x-forwarded-proto": value })),
    ).toBe(expected);
  });

  it("needs the header, whatever the other forwarding headers say", () => {
    const check = createForwardedHttpsCheck(["192.0.2.10"]);

    expect(check(requestFrom("192.0.2.10", {}))).toBe(false);
    expect(
      check(
        requestFrom("192.0.2.10", {
          forwarded: "proto=https;host=pages.example.test",
          "x-forwarded-host": "pages.example.test",
        }),
      ),
    ).toBe(false);
  });

  it("reads the first of repeated header values", () => {
    const check = createForwardedHttpsCheck(["192.0.2.10"]);

    expect(
      check(
        requestFrom("192.0.2.10", { "x-forwarded-proto": ["https", "http"] }),
      ),
    ).toBe(true);
    expect(
      check(
        requestFrom("192.0.2.10", { "x-forwarded-proto": ["http", "https"] }),
      ),
    ).toBe(false);
  });
});
