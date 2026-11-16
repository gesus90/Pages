import { expect, it } from "vitest";

import { pairingEndpoint } from "@/backend/service/remote/setup/SetupPairing";

it("uses the configured public endpoint and chooses secure WebSocket for HTTPS", () => {
  expect(
    pairingEndpoint({
      origin: "http://localhost:3000",
      publicUrl: "https://pages.example",
      connectionId: "id",
      sshHost: "remote",
    }),
  ).toBe("wss://pages.example/runner/v1/channel/id");
  expect(
    pairingEndpoint({
      origin: "http://localhost:3000",
      publicUrl: null,
      connectionId: "id",
      sshHost: "127.0.0.1",
    }),
  ).toBe("ws://localhost:3000/runner/v1/channel/id");
});

it("rejects missing or unreachable loopback addresses", () => {
  expect(() =>
    pairingEndpoint({
      origin: null,
      publicUrl: null,
      connectionId: "id",
      sshHost: "remote",
    }),
  ).toThrow("addressUnknown");
  expect(() =>
    pairingEndpoint({
      origin: "http://localhost:3000",
      publicUrl: null,
      connectionId: "id",
      sshHost: "remote",
    }),
  ).toThrow("loopbackAddress");
});
