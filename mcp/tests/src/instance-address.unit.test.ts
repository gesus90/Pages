import { describe, expect, it } from "vitest";

import {
  instanceEndpoint,
  isPrivateIpv4,
  readInstanceUrl,
} from "../../src/instance-address.ts";

describe("isPrivateIpv4", () => {
  it.each(["10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.20"])(
    "accepts the RFC 1918 address %s",
    (host) => {
      expect(isPrivateIpv4(host)).toBe(true);
    },
  );

  it.each([
    "172.15.0.1",
    "172.32.0.1",
    "192.169.0.1",
    "11.0.0.1",
    "8.8.8.8",
    "localhost",
    "::1",
    "10.0.0",
  ])("rejects %s", (host) => {
    expect(isPrivateIpv4(host)).toBe(false);
  });
});

describe("readInstanceUrl", () => {
  it.each([
    ["https://pages.example", "https://pages.example/"],
    ["https://pages.example/team//", "https://pages.example/team"],
    ["http://localhost:3000/", "http://localhost:3000/"],
    ["http://127.0.0.1:3000", "http://127.0.0.1:3000/"],
    ["http://[::1]:3000", "http://[::1]:3000/"],
    ["http://192.168.0.5/pages/", "http://192.168.0.5/pages"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(readInstanceUrl(input).href).toBe(expected);
  });

  it.each([undefined, "", " https://pages.example", "https://pages.example\n"])(
    "rejects the missing or padded value %j",
    (input) => {
      expect(() => readInstanceUrl(input)).toThrow(
        "PAGES_URL must be an absolute HTTP(S) instance URL.",
      );
    },
  );

  it("rejects a relative address", () => {
    expect(() => readInstanceUrl("/pages")).toThrow(
      "PAGES_URL must be an absolute HTTP(S) instance URL.",
    );
  });

  it.each([
    "http://pages.example",
    "http://8.8.8.8",
    "ftp://localhost",
    "https://user@pages.example",
    "https://user:secret@pages.example",
    "https://pages.example/?query=1",
    "https://pages.example/#fragment",
  ])("rejects the unsafe address %s", (input) => {
    expect(() => readInstanceUrl(input)).toThrow(
      "PAGES_URL requires HTTPS (or loopback/private IPv4 HTTP), without credentials, query or fragment.",
    );
  });
});

describe("instanceEndpoint", () => {
  it("appends the endpoint below the deployment prefix", () => {
    const instance = readInstanceUrl("https://pages.example/team");
    expect(instanceEndpoint(instance, "api/v1/agents").href).toBe(
      "https://pages.example/team/api/v1/agents",
    );
  });

  it("appends the endpoint to a root instance without a double slash", () => {
    const instance = readInstanceUrl("https://pages.example");
    expect(instanceEndpoint(instance, "pair").href).toBe(
      "https://pages.example/pair",
    );
    expect(instance.href).toBe("https://pages.example/");
  });
});
