import { describe, expect, it } from "vitest";

import { parseTrustedProxyEntry } from "@/backend/config/TrustedProxies";

describe("parseTrustedProxyEntry", () => {
  it.each([
    ["127.0.0.1", { address: "127.0.0.1", family: "ipv4", prefix: null }],
    ["::1", { address: "::1", family: "ipv6", prefix: null }],
    [
      "::ffff:192.0.2.10",
      { address: "::ffff:192.0.2.10", family: "ipv6", prefix: null },
    ],
    ["172.18.0.0/16", { address: "172.18.0.0", family: "ipv4", prefix: 16 }],
    ["192.0.2.10/32", { address: "192.0.2.10", family: "ipv4", prefix: 32 }],
    ["fd00::/8", { address: "fd00::", family: "ipv6", prefix: 8 }],
    ["fd00::/128", { address: "fd00::", family: "ipv6", prefix: 128 }],
  ])("reads %s", (entry, expected) => {
    expect(parseTrustedProxyEntry(entry)).toEqual(expected);
  });

  it.each([
    "",
    " 127.0.0.1",
    "localhost",
    "proxy.example.test",
    "*",
    "127.0.0.1:3000",
    "256.0.0.1",
    "fe80::1%eth0",
    "10.0.0.0/",
    "10.0.0.0/0",
    "10.0.0.0/00",
    "10.0.0.0/33",
    "fd00::/129",
    "10.0.0.0/-1",
    "10.0.0.0/8/8",
    "10.0.0.0/eight",
  ])("refuses %j", (entry) => {
    expect(parseTrustedProxyEntry(entry)).toBeNull();
  });
});
