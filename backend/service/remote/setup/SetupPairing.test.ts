import { describe, expect, it } from "vitest";

import { SetupReasonError, pairingEndpoint } from "./SetupPairing";

const ID = "11111111-1111-1111-1111-111111111111";

function endpoint(
  overrides: Partial<Parameters<typeof pairingEndpoint>[0]>,
): string {
  return pairingEndpoint({
    origin: "https://pages.example",
    publicUrl: null,
    connectionId: ID,
    sshHost: "box.example",
    ...overrides,
  });
}

describe("SetupReasonError", () => {
  it("carries the reason", () => {
    const error = new SetupReasonError("addressUnknown");

    expect(error.reason).toBe("addressUnknown");
    expect(error.message).toBe("addressUnknown");
    expect(error.name).toBe("SetupReasonError");
  });
});

describe("pairingEndpoint", () => {
  it("builds a secure channel address from the origin", () => {
    expect(endpoint({})).toBe(`wss://pages.example/runner/v1/channel/${ID}`);
  });

  it("prefers the public address and allows plaintext on request", () => {
    expect(
      endpoint({
        publicUrl: "http://localhost:3000",
        origin: null,
        allowInsecureLan: true,
      }),
    ).toBe(`ws://localhost:3000/runner/v1/channel/${ID}`);
  });

  it("needs some address", () => {
    expect(() => endpoint({ origin: null })).toThrow(
      expect.objectContaining({ reason: "addressUnknown" }),
    );
  });

  it("refuses a loopback origin for a remote machine", () => {
    for (const origin of [
      "https://localhost",
      "https://[::1]",
      "https://127.0.0.1",
      "https://app.localhost",
    ])
      expect(() => endpoint({ origin })).toThrow(
        expect.objectContaining({ reason: "loopbackAddress" }),
      );
  });

  it("accepts a loopback origin for a loopback machine", () => {
    expect(
      endpoint({ origin: "https://localhost", sshHost: "127.0.0.1" }),
    ).toContain("wss://localhost/");
  });
});
