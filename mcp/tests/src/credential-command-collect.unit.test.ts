import { beforeEach, describe, expect, it, vi } from "vitest";

import { runCredentialCommand } from "../../src/credential-command.ts";
import { credentialMessages } from "../../src/credential-messages.ts";
import { CredentialStore } from "../../src/credential-store.ts";
import { openPairingBrowser } from "../../src/pairing-browser.ts";
import { PairingClient, PairingClientError } from "../../src/pairing-client.ts";
import { verifyPages } from "../../src/verification.ts";

import type { McpPairedCredential } from "../../../definition/McpPairing.ts";
import type { CredentialCommandRuntime } from "../../src/credential-command.ts";
import type { DevicePairingRequest } from "../../src/pairing-client.ts";

vi.mock("../../src/pairing-browser.ts", () => ({
  openPairingBrowser: vi.fn(),
}));
vi.mock("../../src/pages-client.ts", () => ({ postAgentRequest: vi.fn() }));
vi.mock("../../src/verification.ts", () => ({ verifyPages: vi.fn() }));

const MESSAGES = credentialMessages({});
const START = Date.UTC(2026, 9, 14, 12);
const PAIR_ARGUMENTS = ["pair", "--url", "https://pages.example"];
const REQUEST: DevicePairingRequest = {
  userCode: "BCDF-GHJK",
  deviceSecret: "s".repeat(43),
  expiresAt: START + 600_000,
  interval: 5,
};
const ISSUED: McpPairedCredential = {
  token: "a".repeat(43),
  tokenId: "token-new",
  name: "Pages MCP",
  expiresAt: null,
  account: { displayName: "Ada Lovelace", username: "ada" },
};

interface Harness {
  readonly messages: string[];
  readonly waits: number[];
  readonly controller: AbortController;
  readonly runtime: Required<CredentialCommandRuntime>;
}

let currentTime = START;

/** Builds terminal boundaries whose waits advance the fake clock. */
function createHarness(): Harness {
  const messages: string[] = [];
  const waits: number[] = [];
  const controller = new AbortController();
  return {
    messages,
    waits,
    controller,
    runtime: {
      signal: controller.signal,
      write: (message) => messages.push(message),
      wait: async (milliseconds) => {
        waits.push(milliseconds);
        currentTime += milliseconds;
      },
      openBrowser: async () => false,
    },
  };
}

/** Lets the exchange fail with the given errors in order before it issues the credential. */
function exchangeFailsWith(...failures: readonly Error[]): void {
  const exchange = vi.mocked(PairingClient.prototype.exchange);
  for (const failure of failures) exchange.mockRejectedValueOnce(failure);
}

/** Returns the backoff notices written while collecting. */
function networkNotices(messages: readonly string[]): string[] {
  return messages.filter((message) => message.startsWith(MESSAGES.network));
}

const pending = (): PairingClientError =>
  new PairingClientError("authorization_pending");
const network = (): PairingClientError => new PairingClientError("network");

beforeEach(() => {
  currentTime = START;
  vi.spyOn(Date, "now").mockImplementation(() => currentTime);
  vi.mocked(verifyPages)
    .mockReset()
    .mockResolvedValue({
      identity: { userId: "user-1", isAdmin: false, permissions: [] },
      tools: [],
    });
  vi.mocked(openPairingBrowser).mockReset().mockResolvedValue(false);
  vi.spyOn(CredentialStore.prototype, "update").mockResolvedValue(null);
  vi.spyOn(PairingClient.prototype, "begin").mockResolvedValue(REQUEST);
  vi.spyOn(PairingClient.prototype, "exchange").mockResolvedValue(ISSUED);
  vi.spyOn(PairingClient.prototype, "cancel").mockResolvedValue();
});

describe("pair collection pacing", () => {
  it("polls at the request interval while approval is pending", async () => {
    const harness = createHarness();
    exchangeFailsWith(pending(), pending());

    const exit = await runCredentialCommand(
      PAIR_ARGUMENTS,
      {},
      harness.runtime,
    );

    expect(exit).toBe(0);
    expect(harness.waits).toEqual([5000, 5000, 5000]);
  });

  it("slows down by five seconds and honours a longer Retry-After", async () => {
    const harness = createHarness();
    exchangeFailsWith(
      new PairingClientError("slow_down", 30),
      new PairingClientError("slow_down"),
      pending(),
    );

    const exit = await runCredentialCommand(
      PAIR_ARGUMENTS,
      {},
      harness.runtime,
    );

    expect(exit).toBe(0);
    expect(harness.waits).toEqual([5000, 30000, 15000, 15000]);
    expect(PairingClient.prototype.exchange).toHaveBeenLastCalledWith(
      { ...REQUEST, interval: 15 },
      harness.controller.signal,
    );
  });

  it("backs off after network failures and announces each retry", async () => {
    const harness = createHarness();
    exchangeFailsWith(
      network(),
      new PairingClientError("temporarily_unavailable"),
      network(),
      network(),
      network(),
    );

    const exit = await runCredentialCommand(
      PAIR_ARGUMENTS,
      {},
      harness.runtime,
    );

    expect(exit).toBe(0);
    expect(harness.waits).toEqual([5000, 5000, 10000, 20000, 30000, 30000]);
    expect(networkNotices(harness.messages)).toEqual(
      [5, 10, 20, 30, 30].map(
        (seconds) => `${MESSAGES.network} ${seconds} ${MESSAGES.seconds}`,
      ),
    );
  });

  it("restarts the backoff once Pages answers again", async () => {
    const harness = createHarness();
    exchangeFailsWith(network(), network(), pending(), network());

    const exit = await runCredentialCommand(
      PAIR_ARGUMENTS,
      {},
      harness.runtime,
    );

    expect(exit).toBe(0);
    expect(harness.waits).toEqual([5000, 5000, 10000, 5000, 5000]);
  });

  it("announces the remaining time once a minute", async () => {
    const harness = createHarness();
    exchangeFailsWith(...Array.from({ length: 24 }, pending));

    const exit = await runCredentialCommand(
      PAIR_ARGUMENTS,
      {},
      harness.runtime,
    );

    expect(exit).toBe(0);
    expect(
      harness.messages.filter((message) =>
        message.startsWith(MESSAGES.remaining),
      ),
    ).toEqual([`${MESSAGES.remaining} 540`, `${MESSAGES.remaining} 480`]);
  });
});

describe("pair collection end", () => {
  it("expires one minute after the code, never announcing negative time", async () => {
    const harness = createHarness();
    vi.mocked(PairingClient.prototype.begin).mockResolvedValue({
      ...REQUEST,
      expiresAt: START + 30_000,
    });
    vi.mocked(PairingClient.prototype.exchange).mockRejectedValue(pending());

    const exit = await runCredentialCommand(
      PAIR_ARGUMENTS,
      {},
      harness.runtime,
    );

    expect(exit).toBe(3);
    expect(harness.messages).toContain(`${MESSAGES.remaining} 0`);
    expect(harness.messages.at(-1)).toBe(MESSAGES.expired);
    expect(harness.waits).toHaveLength(18);
    expect(PairingClient.prototype.exchange).toHaveBeenCalledTimes(17);
    expect(PairingClient.prototype.cancel).not.toHaveBeenCalled();
  });

  it("expires without polling when the code is already past its grace period", async () => {
    const harness = createHarness();
    vi.mocked(PairingClient.prototype.begin).mockResolvedValue({
      ...REQUEST,
      expiresAt: START - 60_000,
    });

    const exit = await runCredentialCommand(
      PAIR_ARGUMENTS,
      {},
      harness.runtime,
    );

    expect(exit).toBe(3);
    expect(harness.waits).toEqual([]);
    expect(PairingClient.prototype.exchange).not.toHaveBeenCalled();
  });

  it.each([
    {
      failure: new PairingClientError("access_denied"),
      exit: 2,
      message: MESSAGES.denied,
    },
    {
      failure: new PairingClientError("expired_token"),
      exit: 3,
      message: MESSAGES.expired,
    },
    {
      failure: new PairingClientError("invalid_grant"),
      exit: 1,
      message: MESSAGES.handoff,
    },
    {
      failure: new PairingClientError("handoff_failed"),
      exit: 1,
      message: MESSAGES.handoff,
    },
    {
      failure: new TypeError("unexpected"),
      exit: 1,
      message: MESSAGES.failed,
    },
  ])(
    "stops on $failure.message with exit $exit",
    async ({ failure, exit, message }) => {
      const harness = createHarness();
      exchangeFailsWith(failure);

      await expect(
        runCredentialCommand(PAIR_ARGUMENTS, {}, harness.runtime),
      ).resolves.toBe(exit);
      expect(harness.messages.at(-1)).toBe(message);
      expect(harness.waits).toEqual([5000]);
      expect(PairingClient.prototype.cancel).not.toHaveBeenCalled();
    },
  );
});

describe("pair cancellation", () => {
  it("cancels the request when aborted while waiting", async () => {
    const harness = createHarness();

    const exit = await runCredentialCommand(
      PAIR_ARGUMENTS,
      {},
      {
        ...harness.runtime,
        wait: async () => harness.controller.abort(),
      },
    );

    expect(exit).toBe(130);
    expect(harness.messages.at(-1)).toBe(MESSAGES.cancelled);
    expect(PairingClient.prototype.exchange).not.toHaveBeenCalled();
    expect(PairingClient.prototype.cancel).toHaveBeenCalledExactlyOnceWith(
      REQUEST,
    );
    expect(CredentialStore.prototype.update).not.toHaveBeenCalled();
  });

  it("asks to revoke manually when cancelling an aborted exchange fails", async () => {
    const harness = createHarness();
    vi.mocked(PairingClient.prototype.exchange).mockImplementation(async () => {
      harness.controller.abort();
      throw new PairingClientError("cancelled");
    });
    vi.mocked(PairingClient.prototype.cancel).mockRejectedValue(network());

    const exit = await runCredentialCommand(
      PAIR_ARGUMENTS,
      {},
      harness.runtime,
    );

    expect(exit).toBe(130);
    expect(harness.messages.slice(-2)).toEqual([
      MESSAGES.offlineRemoved,
      MESSAGES.cancelled,
    ]);
  });
});

describe("credential command runtime defaults", () => {
  it("writes to stderr and removes its SIGINT handler", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const listenersBefore = process.listenerCount("SIGINT");

    const exit = await runCredentialCommand(["sync"], {});

    expect(exit).toBe(4);
    expect(stderrWrite).toHaveBeenCalledExactlyOnceWith(`${MESSAGES.wrong}\n`);
    expect(process.listenerCount("SIGINT")).toBe(listenersBefore);
  });

  it("aborts pairing on SIGINT", async () => {
    const harness = createHarness();
    const listenersBefore = process.listeners("SIGINT");

    const exit = await runCredentialCommand(
      PAIR_ARGUMENTS,
      {},
      {
        write: harness.runtime.write,
        openBrowser: harness.runtime.openBrowser,
        wait: async () => {
          const interrupt = process
            .listeners("SIGINT")
            .find((listener) => !listenersBefore.includes(listener));
          interrupt?.("SIGINT");
        },
      },
    );

    expect(exit).toBe(130);
    expect(harness.messages.at(-1)).toBe(MESSAGES.cancelled);
    expect(PairingClient.prototype.cancel).toHaveBeenCalledOnce();
    expect(process.listeners("SIGINT")).toEqual(listenersBefore);
  });

  it("waits with an abortable timer and registers no SIGINT handler for a given signal", async () => {
    const harness = createHarness();
    const listenersBefore = process.listenerCount("SIGINT");

    const exit = await runCredentialCommand(
      PAIR_ARGUMENTS,
      {},
      {
        write: harness.runtime.write,
        signal: AbortSignal.abort(),
        openBrowser: async () => {
          expect(process.listenerCount("SIGINT")).toBe(listenersBefore);
          return false;
        },
      },
    );

    expect(exit).toBe(130);
    expect(PairingClient.prototype.exchange).not.toHaveBeenCalled();
    expect(PairingClient.prototype.cancel).toHaveBeenCalledOnce();
  });

  it.each([
    { extra: [], noBrowser: false },
    { extra: ["--no-browser"], noBrowser: true },
  ])(
    "opens the browser through the platform opener (noBrowser $noBrowser)",
    async ({ extra, noBrowser }) => {
      const harness = createHarness();
      const environment = { LANG: "en_US.UTF-8" };

      await runCredentialCommand([...PAIR_ARGUMENTS, ...extra], environment, {
        signal: harness.runtime.signal,
        write: harness.runtime.write,
        wait: harness.runtime.wait,
      });

      expect(openPairingBrowser).toHaveBeenCalledExactlyOnceWith(
        new URL("https://pages.example/pair?code=BCDF-GHJK"),
        environment,
        { noBrowser, isTerminal: Boolean(process.stderr.isTTY) },
      );
      expect(harness.messages[1]).toBe(
        `${MESSAGES.fallback} https://pages.example/pair`,
      );
    },
  );
});
