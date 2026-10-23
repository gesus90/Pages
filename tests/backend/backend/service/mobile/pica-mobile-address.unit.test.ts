import { afterEach, describe, expect, it, vi } from "vitest";

import {
  listExternalIpv4Addresses,
  resolvePicaMobileHost,
} from "@/backend/service/mobile/PicaMobileAddress";

import type {
  NetworkInterfaceInfo,
  NetworkInterfaceInfoIPv4,
  NetworkInterfaceInfoIPv6,
} from "node:os";

const interfaces = vi.hoisted(
  (): { value: Record<string, NetworkInterfaceInfo[] | undefined> } => ({
    value: {},
  }),
);

vi.mock("node:os", () => ({
  networkInterfaces: () => interfaces.value,
}));

function ipv4(address: string, isInternal = false): NetworkInterfaceInfoIPv4 {
  return {
    address,
    netmask: "255.255.255.0",
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal: isInternal,
    cidr: null,
  };
}

function ipv6(address: string): NetworkInterfaceInfoIPv6 {
  return {
    address,
    netmask: "ffff:ffff:ffff:ffff::",
    family: "IPv6",
    mac: "00:00:00:00:00:00",
    internal: false,
    cidr: null,
    scopeid: 2,
  };
}

afterEach(() => {
  interfaces.value = {};
});

describe("listExternalIpv4Addresses", () => {
  it("keeps external IPv4 addresses only", () => {
    interfaces.value = {
      lo: [ipv4("127.0.0.1", true)],
      eth0: [ipv4("192.168.0.52"), ipv6("fe80::1"), ipv4("169.254.3.4")],
      down: undefined,
      wlan0: [ipv4("10.0.0.8")],
    };

    expect(listExternalIpv4Addresses()).toEqual(["192.168.0.52", "10.0.0.8"]);
  });
});

describe("resolvePicaMobileHost", () => {
  const networkAddresses = ["192.168.0.52"];

  it("takes the host of the browser when a phone can use it", () => {
    expect(
      resolvePicaMobileHost({
        requestHostname: "pages.example.net",
        networkAddresses,
      }),
    ).toBe("pages.example.net");
    expect(
      resolvePicaMobileHost({
        requestHostname: "192.168.0.9",
        networkAddresses,
      }),
    ).toBe("192.168.0.9");
    expect(
      resolvePicaMobileHost({
        requestHostname: "[fd00::5]",
        networkAddresses,
      }),
    ).toBe("fd00::5");
  });

  it.each(["localhost", "127.0.0.1", "[::1]", "pages.localhost", "0.0.0.0"])(
    "never offers the loopback host %s",
    (requestHostname) => {
      expect(
        resolvePicaMobileHost({ requestHostname, networkAddresses }),
      ).toBe("192.168.0.52");
    },
  );

  it("has no host when the machine has no external address", () => {
    expect(
      resolvePicaMobileHost({
        requestHostname: "localhost",
        networkAddresses: [],
      }),
    ).toBeNull();
  });

  it("prefers a specific listen address over the browser host", () => {
    expect(
      resolvePicaMobileHost({
        requestHostname: "pages.example.net",
        listenAddress: "192.168.0.52",
        networkAddresses,
      }),
    ).toBe("192.168.0.52");
  });

  it("has no host when the listen address is loopback", () => {
    expect(
      resolvePicaMobileHost({
        requestHostname: "pages.example.net",
        listenAddress: "127.0.0.1",
        networkAddresses,
      }),
    ).toBeNull();
  });

  it.each(["0.0.0.0", "::"])(
    "ignores the wildcard listen address %s",
    (listenAddress) => {
      expect(
        resolvePicaMobileHost({
          requestHostname: "192.168.0.9",
          listenAddress,
          networkAddresses,
        }),
      ).toBe("192.168.0.9");
    },
  );
});
